// Cross-module acceptance rehearsal. Transport/native output are simulated:
// never authenticate to the phone's QA database or emit audible notifications.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi} from '../src/lib/driver-api.ts';
import {createDriverOfferAlert} from '../src/lib/driver-offer-alert.ts';
import {QaChatAlerts,qaTone} from '../src/lib/qa-audio.js';
import {CallRinger} from '../driver-android/web/qa-communication.js';

function globals(t){
 const names=['dispatchProDriverQa','dispatchProDriverNative','dispatchProCallNative','localStorage','document','Notification','navigator','setInterval','clearInterval'];
 const saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),events=[],store=new Map(),ticks=new Map();let next=0;
 const values={dispatchProDriverQa:true,dispatchProDriverNative:true,dispatchProCallNative:async(type,data)=>events.push({type,data}),localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},document:{visibilityState:'visible'},Notification:class{static permission='granted';constructor(){throw Error('Android owns notifications');}},navigator:{vibrate(){}},setInterval:fn=>{ticks.set(++next,fn);return next;},clearInterval:id=>ticks.delete(id)};
 for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 t.after(()=>{for(const k of names){if(saved.get(k))Object.defineProperty(globalThis,k,saved.get(k));else Reflect.deleteProperty(globalThis,k);}});
 return {events,ticks};
}

test('sequential optional-destination journeys survive read outage, stop offers, and return Available without replay',async t=>{
 const {events}=globals(t),mutations=[],closed=[];let saved=null,down=false;
 const profile={id:'qa-fixture-driver',status:'Available'},rides=new Map();
 const api=createDriverApi(async(path,init)=>{
  if(down)throw new TypeError('fixture network loss');
  if(path.endsWith('auth/driver-login'))return Response.json({accessToken:'fixture-only',tenant:'fixture-only'});
  if(path.endsWith('driver/me'))return Response.json(profile);
  if(path.includes('driver/updates'))return Response.json({cursor:'fixture-cursor',data:{driver:profile,rides:[...rides.values()].filter(r=>!['Completed','Rejected'].includes(r.status)),notices:[],jobs:[]}});
  const id=path.split('/').at(-2),ride=rides.get(id);
  if(init.method==='PUT'){
   const body=JSON.parse(init.body);assert.equal(body.version,ride.version);mutations.push({id,status:body.status});
   ride.status=body.status;ride.version++;profile.status=['Completed','Rejected'].includes(ride.status)?'Available':'Busy';
   return Response.json({id,status:ride.status,version:ride.version});
  }
  return Response.json(rides.get(path.split('/').at(-1)));
 },{load:async()=>saved,save:async v=>saved=v});
 await api.login('fixture-only','fixture-only','fixture-only');
 const alert=createDriverOfferAlert({closeNotification:async id=>closed.push(id)});
 t.after(()=>alert.dispose());
 for(const [index,destination] of ['QA destination','','QA destination 2'].entries()){
  let ride={id:'fixture-trip-'+index,status:'Assigned',version:1,pickup:'QA pickup',destination};rides.set(ride.id,{...ride});
  assert.equal(alert.offer({id:ride.id}),true);assert.equal(alert.offer({id:ride.id}),false);
  ride=await api.transition(ride,'Accepted');alert.stop(ride.id);qaTone('accepted',ride.id);
  assert.equal(alert.currentId,null);assert.equal(ride.destination,destination);
  for(const status of ['DriverArriving','Arrived','InProgress','Completed']){
   ride=await api.transition(ride,status);assert.equal(ride.status,status);assert.equal(ride.destination,destination);
  }
  down=true;await assert.rejects(api.updates('',undefined,{reconcileOnly:true}));assert.ok(saved?.token);
  down=false;const snap=await api.updates('',undefined,{reconcileOnly:true});
  assert.equal(snap.data.driver.status,'Available');assert.equal(snap.data.rides.length,0);assert.equal(api.pendingCount(),0);
 }
 await Promise.resolve();
 assert.equal(mutations.length,15);assert.equal(closed.length,3);
 assert.equal(events.filter(e=>e.type==='sound.event'&&e.data.kind==='accepted').length,3);
 assert.equal(events.length,3,'No additional trip-step sound was dispatched');
});

test('reject, expiry, reconnect chat replay and outgoing-call cleanup share one Android sound owner',async t=>{
 const {events,ticks}=globals(t),closed=[];let clock=0,refreshes=0;
 const profile={id:'qa-fixture-driver',status:'Available'},writes=[];
 const api=createDriverApi(async(path,init)=>{
  if(path.endsWith('auth/driver-login'))return Response.json({accessToken:'fixture-only',tenant:'fixture-only'});
  if(path.endsWith('driver/me'))return Response.json(profile);
  if(init.method==='PUT'){writes.push(path);return path.endsWith('/reject')?Response.json({status:'Rejected'}):Response.json({code:'OFFER_EXPIRED'},{status:409});}
  throw Error('Unexpected fixture request');
 },{load:async()=>null,save:async()=>{}});
 await api.login('fixture-only','fixture-only','fixture-only');
 await api.reject({id:'fixture-reject',status:'Assigned',version:1});
 await assert.rejects(api.transition({id:'fixture-timeout',status:'Assigned',version:1},'Accepted'),e=>e.status===409);
 assert.equal(api.pendingCount(),0,'Expired acceptance must not enter retry outbox');assert.equal(writes.length,2);
 const alert=createDriverOfferAlert({closeNotification:async id=>closed.push(id),now:()=>clock,refresh:()=>refreshes++});
 t.after(()=>alert.dispose());
 alert.offer({id:'fixture-reject',expiresAt:100});alert.stop('fixture-reject');
 assert.equal(alert.offer({id:'fixture-reject',expiresAt:100}),false);
 alert.offer({id:'fixture-timeout',expiresAt:100});clock=101;for(const tick of [...ticks.values()])tick();
 assert.equal(alert.currentId,null);assert.equal(refreshes,1);assert.equal(alert.offer({id:'fixture-timeout'}),false);
 const data={chat:[{id:'fixture-message',rideId:'office-qa',text:'QA only'},{id:'fixture-own',rideId:'office-qa',mine:true}]};
 new QaChatAlerts('fixture-device').consume(data);new QaChatAlerts('fixture-device').consume(data);
 const ring=new CallRinger(globalThis.dispatchProCallNative);ring.start('incoming');ring.start('outgoing');ring.start('outgoing');ring.stop();
 await Promise.resolve();
 assert.deepEqual(closed,['fixture-reject','fixture-timeout']);
 assert.equal(events.filter(e=>e.type==='sound.ringback'&&e.data.active).length,1);
 assert.equal(events.at(-1).data.active,false);assert.equal(ring.timer,null);
 assert.equal(events.some(e=>e.type==='sound.event'),false,'No self-chat or expiry confirmation tone');
});
