import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi} from '../src/lib/driver-api.ts';
import {createCustomerSession} from '../public/customer-mobile/session.js';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';
import {receptionError} from '../src/lib/reception-feedback.ts';
const profile={id:'driver-a',fullName:'Test Driver',status:'Offline'};
function store(value=null){return {value,async load(){return this.value;},async save(v){this.value=v;}};}
const session={token:'test-token',tenant:'tenant-a',profile};

test('Driver bootstrap loads persisted identity before any protected request, validates it, then restores on restart',async()=>{
 let release;const storage=store(session);storage.load=()=>new Promise(r=>release=r);const calls=[];
 const api=createDriverApi(async(path,init)=>{calls.push({path,auth:init.headers.Authorization});return Response.json(path.endsWith('/me')?profile:{items:[]});},storage);
 const pending=api.history();assert.equal(calls.length,0);release(session);await pending;
 assert.deepEqual(calls.map(c=>c.path),['/api/reception/driver/me','/api/reception/driver/history?page=1']);assert.ok(calls.every(c=>c.auth==='Bearer test-token'));
 storage.load=async()=>storage.value; const restarted=createDriverApi(async()=>Response.json(profile),storage);assert.equal((await restarted.bootstrap()).id,profile.id);assert.equal(restarted.sessionIdentity().tenant,'tenant-a');
});
test('Driver login persists JWT and exact identity without persisting the password; logout removes it',async()=>{
 const storage=store(),api=createDriverApi(async p=>Response.json(p.endsWith('/auth/driver-login')?{accessToken:'issued-token'}:profile),storage);
 await api.login('tenant-a','ramzi','test-only-password');assert.equal(storage.value.profile.id,profile.id);assert.equal(JSON.stringify(storage.value).includes('test-only-password'),false);api.logout();await Promise.resolve();assert.equal(storage.value,null);
});
test('Driver optional 401 verifies primary identity; 403, network and server failures retain valid session',async()=>{
 const storage=store(session);let status=200;const api=createDriverApi(async p=>{if(p.endsWith('/me'))return Response.json(profile);if(status===0)throw new TypeError('offline');return Response.json({}, {status});},storage);
 await api.bootstrap();for(const code of [401,403,503,0]){status=code;await assert.rejects(api.earnings(),e=>e.status===code&&!e.sessionInvalid);assert.ok(api.authenticated());assert.ok(storage.value);}
});
test('Driver server-confirmed primary 401 clears persisted session; protected writes are never replayed',async()=>{
 const storage=store(session),api=createDriverApi(async()=>new Response(null,{status:401}),storage);assert.equal(await api.bootstrap(),null);assert.equal(storage.value,null);
 let writes=0,deny=false;const other=createDriverApi(async(p,init)=>{if(p.endsWith('/auth/driver-login'))return Response.json({accessToken:'token'});if(p.endsWith('/me'))return deny?new Response(null,{status:401}):Response.json(profile);if(init.method==='PUT')writes++;return new Response(null,{status:401});},store());await other.login('office','user','test-only');deny=true;await assert.rejects(other.availability('Available'),e=>e.sessionInvalid);assert.equal(writes,1);assert.equal(other.authenticated(),false);
});
test('Driver refuses restored identity mismatch; two accounts never share a session owner',async()=>{
 const a=createDriverApi(async()=>Response.json({...profile,id:'other-driver'}),store(session));assert.equal(await a.bootstrap(),null);assert.equal(a.authenticated(),false);
 const first=createDriverApi(async()=>Response.json(profile),store(session));const second=createDriverApi(async()=>Response.json({...profile,id:'driver-b'}),store({...session,token:'b-token',profile:{...profile,id:'driver-b'}}));await Promise.all([first.bootstrap(),second.bootstrap()]);assert.equal(first.sessionIdentity().driverId,'driver-a');assert.equal(second.sessionIdentity().driverId,'driver-b');
});
test('Driver restoration survives offline startup; reconnection validates the retained JWT',async()=>{
 let online=false;const storage=store(session);const api=createDriverApi(async()=>{if(!online)throw Error('offline');return Response.json(profile);},storage);assert.equal((await api.bootstrap()).id,profile.id);assert.ok(storage.value);online=true;await api.history();assert.ok(api.authenticated());
});
test('late Driver 401 cannot expire a newer login',async()=>{
 let resolve,logins=0;const api=createDriverApi(async p=>p.endsWith('/auth/driver-login')?Response.json({accessToken:'token-'+(++logins)}):p.endsWith('/me')?Response.json(profile):new Promise(r=>resolve=r),store());await api.login('office','a','test-only');const old=api.history();await new Promise(setImmediate);await api.login('office','b','test-only');resolve(new Response(null,{status:401}));await assert.rejects(old,e=>!e.sessionInvalid);assert.ok(api.authenticated());
});
const device={tenant:'tenant-a',accountId:'11111111-1111-1111-1111-111111111111',deviceSecret:'test-only-secret'};
test('Customer bootstrap barrier obtains device login before protected request; restart reuses identity',async()=>{
 let release;const calls=[];const auth=createCustomerSession({device:()=>device,fetchImpl:async(p,init)=>{calls.push({p,auth:init.headers.Authorization});return p.endsWith('/login')?new Promise(r=>release=()=>r(Response.json({accessToken:'customer-token'}))):Response.json({id:'customer-a'});}});
 const pending=auth.request('me');assert.equal(calls.length,1);assert.ok(calls[0].p.endsWith('/login'));release();assert.equal((await pending).id,'customer-a');assert.equal(calls[1].auth,'Bearer customer-token');
});
test('Customer optional 401, 403 and offline do not discard valid account session',async()=>{
 let status=200,invalidations=0;const auth=createCustomerSession({device:()=>device,onInvalid:()=>invalidations++,fetchImpl:async p=>{if(p.endsWith('/login'))return Response.json({accessToken:'token'});if(p.endsWith('/me'))return Response.json({id:'customer-a'});if(status===0)throw Error('offline');return Response.json({}, {status});}});
 await auth.login();for(const code of [401,403,503,0]){status=code;await assert.rejects(auth.request('history'),e=>e.status===code&&!e.sessionInvalid);assert.equal(auth.authenticated(),true);}assert.equal(invalidations,0);
});
test('Customer confirmed invalid primary credential locks session while preserving device recovery data',async()=>{
 let invalid=false;const auth=createCustomerSession({device:()=>device,onInvalid:()=>invalid=true,fetchImpl:async()=>new Response(null,{status:401})});await assert.rejects(auth.request('me'),e=>e.sessionInvalid);assert.ok(invalid);assert.equal(auth.authenticated(),false);assert.equal(device.tenant,'tenant-a');
});
test('Customer concurrent expired requests share one credential renewal',async()=>{
 let logins=0;const auth=createCustomerSession({device:()=>device,fetchImpl:async(p,init)=>{if(p.endsWith('/login')){logins++;await new Promise(setImmediate);return Response.json({accessToken:'renewed'});}return init.headers.Authorization==='Bearer old'?new Response(null,{status:401}):Response.json({});}});auth.accept('old');await Promise.all([auth.request('me'),auth.request('history')]);assert.equal(logins,1);
});
test('Office local browser refresh restores the same JWT, and wrong credentials have a specific Arabic error',async()=>{
 const old=globalThis.window,storage=new Map();globalThis.window={location:new URL('http://127.0.0.1:9005'),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 const token='test.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+300,sub:'user',tenant:'tenant'})).toString('base64url')+'.test';
 try{const first=createApiReceptionBackend(async p=>Response.json(p.endsWith('/login')?{accessToken:token}:{}));await first.login('office','user','test-only');const restored=createApiReceptionBackend(async(p,init)=>{assert.equal(init.headers.Authorization,'Bearer '+token);return Response.json({});});await restored.office();assert.ok(restored.authSnapshot().authenticated);const denied=createApiReceptionBackend(async()=>new Response(null,{status:401}));await assert.rejects(denied.login('office','user','wrong'),e=>receptionError(e)==='بيانات الدخول غير صحيحة');}finally{globalThis.window=old;}
});


test('stale Driver profile completion cannot clear or overwrite a newer login identity',async()=>{
 let resolveOld,first=true;const api=createDriverApi(async p=>{if(p.endsWith('/auth/driver-login'))return Response.json({accessToken:'token'});if(first){first=false;return new Promise(r=>resolveOld=r);}return Response.json({...profile,id:'driver-b'});},store());const old=api.login('office','a','test-only');await new Promise(setImmediate);await api.login('office','b','test-only');resolveOld(Response.json(profile));await assert.rejects(old);assert.equal(api.sessionIdentity().driverId,'driver-b');assert.ok(api.authenticated());
});
