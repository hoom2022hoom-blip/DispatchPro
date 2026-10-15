import test from 'node:test';import assert from 'node:assert/strict';
import {proxyReception} from '../src/lib/reception-proxy.ts';
import {proxyCustomer} from '../src/lib/customer-proxy.ts';
import {sessionCookie} from '../src/lib/office-session-cookie.ts';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';
import {createDriverApi} from '../src/lib/driver-api.ts';
test('bound office configuration overrides client tenant for Office, Driver and Customer login/registration',async()=>{
 for(const customer of [false,true])for(const route of customer?['login','register']:['auth/login']){
  let sent;const request=new Request('https://office.test/api',{method:'POST',body:JSON.stringify({tenant:'other-tenant',username:'test',password:'test-only'})});
  const transport=async(url,init)=>{sent=JSON.parse(init.body instanceof Uint8Array?new TextDecoder().decode(init.body):init.body);return Response.json({});};
  const result=customer?await proxyCustomer(request,[route],'http://127.0.0.1:9010',transport,'bound-office'):await proxyReception(request,route.split('/'),'http://127.0.0.1:9010',transport,'bound-office');
  assert.equal(result.status,200);assert.equal(sent.tenant,'bound-office');
 }
});
test('Office remember cookie is HttpOnly, same site, HTTPS secure and bounded by JWT expiry',()=>{
 const token='test.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+300})).toString('base64url')+'.test';
 const request=new Request('https://office.test/api/reception/auth/login');
 const cookie=sessionCookie(request,token,true);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);assert.ok(Number(cookie.match(/Max-Age=(\d+)/)[1])<=300);assert.doesNotMatch(sessionCookie(request,token,false),/Max-Age/);assert.match(sessionCookie(request,'',false),/Max-Age=0/);
});
test('Office fresh browser restores server-validated cookie without password storage',async()=>{
 const old=globalThis.window;globalThis.window={sessionStorage:{getItem:()=>null,removeItem(){}}};
 try{const token='test.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+300,tenant:'tenant',sub:'user'})).toString('base64url')+'.test';const calls=[];const api=createApiReceptionBackend(async path=>{calls.push(path);return Response.json({accessToken:token,tenant:'bound-office'});},true);await api.bootstrap();assert.equal(api.authSnapshot().authenticated,true);assert.equal(api.authSnapshot().tenant,'bound-office');assert.deepEqual(calls,['/api/reception/auth/session']);}finally{globalThis.window=old;}
});
test('Driver unchecked remember does not persist credentials or session; checked uses supplied secure storage',async()=>{
 let saved=null;const store={load:async()=>saved,save:async value=>{saved=value;}};const transport=async path=>Response.json(/auth\/(driver-)?login$/.test(path)?{accessToken:'driver-token',tenant:'bound-office'}:{id:'driver',fullName:'Test',status:'Available'});
 const api=createDriverApi(transport,store);await api.login('','driver','test-only',false);assert.equal(saved,null);assert.ok(api.authenticated());await api.login('','driver','test-only',true);assert.equal(saved.tenant,'bound-office');assert.equal(saved.profile.id,'driver');assert.equal('password' in saved,false);
});

test('offline Office logout prevents cookie resurrection on reload',async()=>{
 const old=globalThis.window;const store=new Map();globalThis.window={sessionStorage:{getItem:()=>null,removeItem(){}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}};
 try{const api=createApiReceptionBackend(async()=>{throw Error('offline');},true);api.logout();let calls=0;const reload=createApiReceptionBackend(async(path,init)=>{if(init?.method!=='DELETE')calls++;return Response.json({accessToken:'stale'});},true);await reload.bootstrap();assert.equal(reload.authSnapshot().authenticated,false);assert.equal(calls,0);}finally{globalThis.window=old;}
});
