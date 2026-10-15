import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s==='./office-session-cookie'&&c.parentURL?.endsWith('/office-renewal.ts'))return next(new URL('../src/lib/office-session-cookie.ts',import.meta.url).href,c);return next(s,c);}});
const {renewOfficeSession}=await import('../src/lib/office-renewal.ts');
const jwt=now=>'test.'+Buffer.from(JSON.stringify({exp:Math.floor(now/1000)+1800,tenant:'tenant-a',sub:'employee-a'})).toString('base64url')+'.test';
function storage(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}

test('expired access renews once for simultaneous requests, preserves clock skew and survives reload/browser reopen/offline',async()=>{
 const before=globalThis.window,oldNow=Date.now;let now=oldNow(),online=true,renewals=0,invalid=false,access=jwt(now);
 const local=storage(),tab=storage();const listeners={};let api;
 globalThis.window={localStorage:local,sessionStorage:tab,addEventListener:(name,fn)=>listeners[name]=fn};Date.now=()=>now+3600000;
 const fetcher=async(path,init)=>{
  if(!online)throw Error('offline');
  if(path.endsWith('auth/login'))return Response.json({accessToken:access,renewable:true,tenant:'office'},{headers:{Date:new Date(now).toUTCString()}});
  if(path.endsWith('auth/session')){if(init.method==='DELETE'){invalid=true;return new Response(null,{status:204});}renewals++;if(invalid)return new Response(null,{status:401});access=jwt(now);return Response.json({accessToken:access,renewable:true,tenant:'office'},{headers:{Date:new Date(now).toUTCString()}});}
  assert.equal(init.headers.Authorization,'Bearer '+access);return Response.json({drivers:[]});
 };
 try{
  api=createApiReceptionBackend(fetcher,true);await api.login('office','user','test-only');const initial=renewals;
  now+=1801000;await Promise.all([api.office(),api.office()]);assert.equal(renewals,initial+1);assert.ok(api.session());
  const reload=createApiReceptionBackend(fetcher,true);await reload.bootstrap();await reload.office();assert.ok(reload.authSnapshot().authenticated);
  globalThis.window.sessionStorage=storage();now+=86400000*30;
  const reopen=createApiReceptionBackend(fetcher,true);await reopen.bootstrap();await reopen.office();assert.ok(reopen.session());
  now+=3600000;online=false;await assert.rejects(reopen.office(),e=>e.status===503&&!e.sessionInvalid);assert.ok(reopen.authSnapshot().authenticated);
  // A browser restarted while offline retains a nonsecret identity hint and retries restoration.
  globalThis.window.sessionStorage=storage();const offlineReopen=createApiReceptionBackend(fetcher,true);await offlineReopen.bootstrap();assert.ok(offlineReopen.session());
  online=true;await offlineReopen.office();assert.ok(offlineReopen.authSnapshot().authenticated);
  invalid=true;now+=3600000;await assert.rejects(offlineReopen.office(),e=>e.sessionInvalid);assert.equal(offlineReopen.authSnapshot().authenticated,false);
  api.logout();reload.logout();reopen.logout();offlineReopen.logout();
 }finally{Date.now=oldNow;globalThis.window=before;}
});

test('refresh secret stays HttpOnly; renewal works without access JWT and logout clears cookies',async()=>{
 const req=new Request('https://office.example/api/reception/auth/session',{method:'POST',headers:{cookie:'dispatchpro.office.refresh=server-secret'}});
 const result=await renewOfficeSession(req,'http://127.0.0.1:9010',async(url,init)=>{
  assert.ok(url.endsWith('/auth/refresh'));assert.equal(JSON.parse(init.body).refreshToken,'server-secret');
  return Response.json({accessToken:jwt(Date.now()),refreshToken:'rotated-secret',tenant:'office'},{headers:{Date:new Date().toUTCString()}});
 });
 const body=await result.json();assert.equal(body.refreshToken,undefined);assert.equal(body.renewable,true);
 assert.match(result.headers.get('set-cookie'),/HttpOnly/);assert.match(result.headers.get('set-cookie'),/rotated-secret/);
 const logout=await renewOfficeSession(new Request(req.url,{method:'DELETE',headers:req.headers}),'http://127.0.0.1:9010',async()=>new Response(null,{status:204}));
 assert.equal(logout.status,204);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});

test('temporary renewal failure does not erase the persistent cookie',async()=>{
 const req=new Request('https://office.example/api/reception/auth/session',{method:'POST',headers:{cookie:'dispatchpro.office.refresh=server-secret'}});
 const failed=await renewOfficeSession(req,'http://127.0.0.1:9010',async()=>{throw Error('offline');});assert.equal(failed.status,503);assert.equal(failed.headers.get('set-cookie'),null);
});
