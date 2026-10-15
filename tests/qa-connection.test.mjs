import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi,DriverApiError} from '../src/lib/driver-api.ts';
import {qaConnectionFailure,qaHttpFailure} from '../src/lib/qa-connection-error.js';

for(const code of ['OFFLINE','ENDPOINT_DNS','TLS_ERROR','SERVER_TIMEOUT','QA_LOCAL_TIMEOUT','QA_LOCAL_UNAVAILABLE','SERVER_UNAVAILABLE']){
 test('QA login reports transport category '+code,async t=>{
  const prior=globalThis.dispatchProDriverQa;globalThis.dispatchProDriverQa=true;t.after(()=>globalThis.dispatchProDriverQa=prior);
  const api=createDriverApi(async()=>{throw Object.assign(new Error('private request body must not leak'),{code});},{load:async()=>null,save:async()=>{}});
  await assert.rejects(api.login('driver-qa','qa.driver','fake'),e=>e instanceof DriverApiError&&e.status===0&&e.code===code&&!e.message.includes('private request'));
 });
}
test('QA HTTP outage is distinct from bad credentials',async t=>{
 const prior=globalThis.dispatchProDriverQa;globalThis.dispatchProDriverQa=true;t.after(()=>globalThis.dispatchProDriverQa=prior);
 for(const status of [502,503,504,530]){
  const api=createDriverApi(async()=>Response.json({code:'QA_UPSTREAM_UNAVAILABLE'},{status}),{load:async()=>null,save:async()=>{}});
  await assert.rejects(api.login('driver-qa','qa.driver','fake'),e=>e.status===status&&e.code==='QA_UPSTREAM_UNAVAILABLE'&&!e.message.includes('الإنترنت'));
 }
 assert.equal(qaHttpFailure(401).code,'AUTH_FAILED');assert.equal(qaHttpFailure(403).code,'FORBIDDEN');
 assert.equal(qaConnectionFailure({name:'TimeoutError'}).code,'SERVER_TIMEOUT');assert.equal(qaConnectionFailure({},false).code,'OFFLINE');
});
test('server outage retains cached session and recovery sends no trip mutation',async t=>{
 const prior=globalThis.dispatchProDriverQa;globalThis.dispatchProDriverQa=true;t.after(()=>globalThis.dispatchProDriverQa=prior);
 const saved={token:'fake',tenant:'driver-qa',profile:{id:'qa-driver',status:'Available'},snapshot:{driver:{id:'qa-driver',status:'Available'},rides:[],notices:[]}};
 let down=true;const writes=[],calls=[];
 const api=createDriverApi(async(url,init)=>{calls.push({url,method:init.method});if(down)throw Object.assign(new Error('offline service'),{code:'QA_LOCAL_UNAVAILABLE'});if(url.endsWith('driver/me'))return Response.json(saved.profile);return Response.json({cursor:'new',data:saved.snapshot,serverTime:new Date().toISOString()});},{load:async()=>saved,save:async value=>writes.push(value)});
 assert.equal((await api.bootstrap()).id,'qa-driver');assert.equal(api.authenticated(),true);assert.equal(writes.length,0);
 await assert.rejects(api.updates('',undefined,{reconcileOnly:true}),e=>e.code==='QA_LOCAL_UNAVAILABLE');assert.equal(api.authenticated(),true);
 down=false;assert.equal((await api.updates('',undefined,{reconcileOnly:true})).data.driver.status,'Available');assert.ok(calls.every(c=>c.method==='GET'));assert.ok(!writes.some(v=>v===null));
});
test('cancelled UI request is not relabelled as connectivity failure',async t=>{
 const prior=globalThis.dispatchProDriverQa;globalThis.dispatchProDriverQa=true;t.after(()=>globalThis.dispatchProDriverQa=prior);
 const abort=new AbortController();const cancelled=new DOMException('cancelled','AbortError');abort.abort(cancelled);
 const api=createDriverApi(async()=>{throw cancelled;},{load:async()=>({token:'fake',tenant:'driver-qa',profile:{id:'d',status:'Available'}}),save:async()=>{}});
 await api.bootstrap(true);await assert.rejects(api.ride('fake',abort.signal),e=>e===cancelled);
});
