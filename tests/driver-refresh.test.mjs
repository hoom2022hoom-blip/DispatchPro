import test from 'node:test';import assert from 'node:assert/strict';
import {createDriverApi} from '../src/lib/driver-api.ts';
const profile={id:'driver',fullName:'Driver',status:'Available'};
const json=(value,status=200)=>Response.json(value,{status});
test('Android remember-off login supplies the native duty worker with an ephemeral session',async()=>{
 const previous=globalThis.dispatchProDriverStorage;const writes=[];
 const storage={load:async()=>null,save:async(value,remember=true)=>writes.push({value,remember})};
 globalThis.dispatchProDriverStorage=storage;
 try{
  const api=createDriverApi(async path=>path.endsWith('auth/driver-login')?json({accessToken:'native-test-token',refreshToken:'native-test-refresh',tenant:'office'}):json(profile),storage);
  await api.login('office','driver','test-password',false);
  assert.equal(writes.at(-1).remember,false);assert.equal(writes.at(-1).value.token,'native-test-token');assert.equal(writes.at(-1).value.profile.id,'driver');
  api.logout();await new Promise(setImmediate);assert.equal(writes.at(-1).value,null);
 }finally{if(previous)globalThis.dispatchProDriverStorage=previous;else delete globalThis.dispatchProDriverStorage;}
});
test('expired access renews once across simultaneous requests and persists the replacement',async()=>{
 let saved={token:'expired',tenant:'office',profile},renewals=0;
 const api=createDriverApi(async(path,options)=>{if(path.endsWith('driver-refresh')){renewals++;await new Promise(setImmediate);return json({accessToken:'fresh'});}return options.headers.Authorization==='Bearer fresh'?json(profile):json({},401);},{load:async()=>saved,save:async value=>saved=value});
 assert.deepEqual(await api.bootstrap(),profile);assert.equal(saved.token,'fresh');
 assert.equal(renewals,1);await Promise.all([api.voice('voice/updates'),api.voice('voice/updates')]);assert.equal(renewals,1);
});
test('temporary refresh failure retains identity; only invalid refresh ends the session',async()=>{
 let saved={token:'expired',tenant:'office',profile},invalid=false;
 const api=createDriverApi(async path=>path.endsWith('driver-refresh')?json({},invalid?401:503):json({},401),{load:async()=>saved,save:async value=>saved=value});
 assert.deepEqual(await api.bootstrap(),profile);assert.ok(saved);assert.equal(api.authenticated(),true);
 invalid=true;await assert.rejects(api.voice('voice/updates'),e=>e.sessionInvalid===true);assert.equal(saved,null);
});
test('two expired in-flight requests share renewal and each retries with the new access token',async()=>{
 let token='old',expired=false,renewals=0,saved={token,tenant:'office',profile};
 const api=createDriverApi(async(path,options)=>{if(path.endsWith('driver-refresh')){renewals++;await new Promise(setImmediate);return json({accessToken:'new'});}if(!expired||options.headers.Authorization==='Bearer new')return json(profile);await new Promise(setImmediate);return json({},401);},{load:async()=>saved,save:async value=>saved=value});
 await api.bootstrap();expired=true;const values=await Promise.all([api.voice('voice/updates'),api.voice('driver/updates')]);assert.equal(values.length,2);assert.equal(renewals,1);assert.equal(saved.token,'new');
});

test('an optional 401 with a valid primary identity never rotates or removes the driver session',async()=>{
 let saved={token:'valid',refreshToken:'retained',tenant:'office',profile},renewals=0;
 const api=createDriverApi(async path=>{
  if(path.endsWith('driver-refresh')){renewals++;return json({},401);}
  return path.endsWith('driver/me')?json(profile):json({},401);
 },{load:async()=>saved,save:async value=>saved=value});
 await api.bootstrap();await assert.rejects(api.voice('voice/updates'),e=>e.status===401&&!e.sessionInvalid);
 assert.equal(renewals,0);assert.equal(saved.refreshToken,'retained');assert.equal(api.authenticated(),true);
});
