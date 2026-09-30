import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';

test('external office session survives reload, expires, and is removed on logout without storing password', async()=>{
 const values=new Map();
 globalThis.window={location:{protocol:'https:',hostname:'office.example.test'},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
 const token='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+1800})).toString('base64url')+'.signature';
 const calls=[];
 const fetcher=async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('auth/login')?{accessToken:token}:{ok:true});};
 try{
  const first=createApiReceptionBackend(fetcher);await first.login(' office ',' dispatcher ','secret-password');
  assert.equal(values.size,1);assert.ok(![...values.values()][0].includes('secret-password'));
  const reloaded=createApiReceptionBackend(fetcher);assert.deepEqual(reloaded.session(),{tenant:'office'});
  await reloaded.office();assert.equal(calls.at(-1).init.headers.Authorization,'Bearer '+token);
  await reloaded.office();assert.deepEqual(reloaded.session(),{tenant:'office'});
  reloaded.logout();assert.equal(values.size,0);assert.equal(createApiReceptionBackend(fetcher).session(),null);
  const key='dispatchpro.external-office-session';
  values.set(key,JSON.stringify({tenant:'office',token:'x.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.x'}));
  assert.equal(createApiReceptionBackend(fetcher).session(),null);assert.equal(values.size,0);
 }finally{delete globalThis.window;}
});

test('external invalid credentials differ from session expiry; 401 clears restored session and local login stays memory-only',async()=>{
 const values=new Map();globalThis.window={location:{protocol:'https:',hostname:'office.example.test'},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
 try{
  const denied=createApiReceptionBackend(async()=>Response.json({},{status:401}));
  await assert.rejects(()=>denied.login('office','wrong','wrong'),/بيانات الدخول/);
  const token='h.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+1800})).toString('base64url')+'.s';
  const api=createApiReceptionBackend(async url=>url.endsWith('auth/login')?Response.json({accessToken:token}):Response.json({},{status:401}));
  await api.login('office','test','secret');await assert.rejects(()=>api.office(),/انتهت جلسة/);assert.equal(api.session(),null);assert.equal(values.size,0);
  window.location={protocol:'http:',hostname:'127.0.0.1'};
  await api.login('office','test','secret');assert.equal(values.size,0);assert.equal(api.externalSession(),false);
 }finally{delete globalThis.window;}
});

test('logout during login cannot resurrect an external session',async()=>{
 let resolve;const api=createApiReceptionBackend(()=>new Promise(r=>resolve=r));
 const login=api.login('office','test','secret');api.logout();resolve(Response.json({accessToken:'late'}));
 await assert.rejects(()=>login,/أُغلقت/);assert.equal(api.session(),null);
});
