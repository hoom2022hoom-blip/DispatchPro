import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi} from '../src/lib/driver-api.ts';
import {normalizePhone} from '../src/lib/phone-normalization.js';
const profile={id:'driver',fullName:'Driver',status:'Available'};
const stored=()=>({token:'token',tenant:'office',profile});
test('cached startup reaches profile without any network dependency',async()=>{
 let calls=0;const api=createDriverApi(async()=>{calls++;return new Promise(()=>{});},{load:async()=>stored(),save:async()=>{}});
 const start=performance.now();const cached=await api.bootstrap(true);assert.equal(cached.id,profile.id);assert.equal(cached.status,profile.status);assert.equal(calls,0);assert.ok(performance.now()-start<100);
});
test('Palestinian display handles prefixes, punctuation and Arabic digits',()=>{
 for(const input of ['+970592081197','+972592081197','0592 081 197','(0592)-081-197','٠٥٩٢٠٨١١٩٧'])assert.equal(normalizePhone(input),'0592081197');
});
test('revoked device session exits with the exact explanation without refresh retry',async()=>{
 let saved=stored(),calls=0;const api=createDriverApi(async()=>{calls++;return Response.json({code:'SESSION_REPLACED'},{status:401});},{load:async()=>saved,save:async v=>saved=v});await api.bootstrap(true);
 await assert.rejects(api.updates(),e=>e.sessionInvalid&&e.message==='تم تسجيل الدخول إلى حسابك من جهاز آخر');assert.equal(saved,null);assert.equal(calls,1);
});
for(const committed of [false,true])test(`ambiguous order response queues once and reconciles ${committed?'committed':'uncommitted'} action`,async()=>{
 let saved=stored(),offline=true,puts=0;const ride={id:'ride',status:'Assigned',version:1};
 const api=createDriverApi(async(path,init)=>{
  if(init.method==='PUT'){puts++;if(offline)throw Error('network');return Response.json({ok:true});}
  if(path.endsWith('driver/rides/ride'))return Response.json({...ride,version:committed?2:1,status:committed?'Accepted':'Assigned'});
  return Response.json({cursor:'x',data:{driver:profile,rides:[],notices:[]}});
 },{load:async()=>saved,save:async v=>saved=v});await api.bootstrap(true);
 await assert.rejects(api.transition(ride,'Accepted'),/حُفظ الإجراء/);assert.equal(saved.outbox.length,1);
 offline=false;await api.updates();assert.equal(saved.outbox.length,0);assert.equal(puts,committed?1:2);await api.updates();assert.equal(puts,committed?1:2);
});
test('temporary failures preserve login and pending availability across restart',async()=>{
 let saved=stored();const adapter={load:async()=>saved,save:async v=>saved=v};
 const api=createDriverApi(async()=>Response.json({},{status:503}),adapter);await api.bootstrap(true);await assert.rejects(api.availability('Offline'),/حُفظ الإجراء/);assert.ok(saved.token);
 const restarted=createDriverApi(async(path,init)=>Response.json(init.method==='PUT'?{ok:true}:{cursor:'x',data:{driver:profile,rides:[],notices:[]}}),adapter);await restarted.bootstrap(true);assert.equal(restarted.pendingCount(),1);await restarted.updates();assert.equal(restarted.pendingCount(),0);assert.equal(restarted.authenticated(),true);
});

for(const status of [429,500,530])test(`HTTP ${status} preserves one driver action until a successful replay`,async()=>{
 let saved=stored(),failure=status,writes=0;const adapter={load:async()=>saved,save:async value=>saved=value};
 const api=createDriverApi(async(path,init)=>{
  if(init.method==='PUT'){writes++;return Response.json({ok:!failure},{status:failure||200});}
  return Response.json({cursor:'x',data:{driver:profile,rides:[],notices:[]}});
 },adapter);
 await api.bootstrap(true);
 await assert.rejects(api.availability('Offline'),/حُفظ الإجراء/);assert.equal(saved.outbox.length,1);assert.ok(saved.token);
 await assert.rejects(api.updates(),e=>e.status===status);assert.equal(saved.outbox.length,1,'A transient replay response must keep the command');
 failure=0;await api.updates();assert.equal(saved.outbox.length,0);await api.updates();assert.equal(writes,3);
});

test('expired access on replaced device explains revocation during renewal',async()=>{
 let saved=stored();const api=createDriverApi(async path=>Response.json(path.endsWith('driver-refresh')?{code:'SESSION_REPLACED'}:{},{status:401}),{load:async()=>saved,save:async v=>saved=v});await api.bootstrap(true);await assert.rejects(api.updates(),e=>e.sessionInvalid&&e.message==='تم تسجيل الدخول إلى حسابك من جهاز آخر');assert.equal(saved,null);
});

for(const disabled of [false,true])test(`driver watch permission failure ${disabled?'logs out a disabled account':'retains an active account'}`,async()=>{
 let saved=stored();const api=createDriverApi(async path=>Response.json(path.endsWith('driver/me')?profile:{},{status:path.endsWith('driver/me')&&!disabled?200:403}),{load:async()=>saved,save:async v=>saved=v});await api.bootstrap(true);await assert.rejects(api.updates(),e=>e.sessionInvalid===disabled);assert.equal(saved===null,disabled);
});
