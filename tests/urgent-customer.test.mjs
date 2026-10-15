import test from 'node:test';
import assert from 'node:assert/strict';
import {customerMobile} from './helpers/customer-mobile.mjs';
import {createDriverApi} from '../src/lib/driver-api.ts';

test('opening menu reveals settings; native back returns to map without discarding ride',async()=>{
 const ride={id:'live',status:'IN_PROGRESS',pickup:'القدس',destination:'رفيديا'};
 const h=await customerMobile({rides:[ride]});h.nodes.get('customer-menu').onclick();
 assert.equal(h.nodes.get('profile-panel').hidden,false);assert.equal(h.nodes.get('request-panel').hidden,true);
 assert.equal(h.context.window.dispatchProCustomerBack(),true);
 assert.equal(h.nodes.get('request-panel').hidden,false);assert.equal(h.context.hooks.state().activeRide.id,'live');
 assert.equal(h.context.window.dispatchProCustomerBack(),false);
});
test('unchanged snapshots preserve the actual trip card and do not refetch history on rapid tabs',async()=>{
 const h=await customerMobile({rides:[{id:'live',status:'IN_PROGRESS',pickup:'انطلاق',destination:'وجهة'}]});
 const first=h.nodes.get('rides').children[0];h.context.hooks.watch();await h.flush();
 assert.equal(h.nodes.get('rides').children[0],first);
 h.nodes.get('history-tab').onclick();await h.flush();h.nodes.get('request-tab').onclick();h.nodes.get('history-tab').onclick();await h.flush();
 assert.equal(h.calls.filter(c=>c.url.includes('/history?')).length,1);
});
test('current requests include scheduled bookings and compact card retains contact actions outside details',async()=>{
 const ride={id:'scheduled',status:'ACCEPTED',pickup:'القدس',destination:'رفيديا',scheduledAt:'2026-12-01T10:00:00Z',notes:'مع طفل',driver:{fullName:'سائق',phone:'0591234567'}};
 const h=await customerMobile({rides:[ride]});h.nodes.get('history-current').onclick();
 assert.equal(h.nodes.get('history').children[0].dataset.rideId,'scheduled');
 const card=h.context.hooks.card(ride);assert.ok(card.children.some(n=>n.tagName==='BUTTON'&&n.dataset.chatRide===ride.id));
 assert.match(h.text(card.querySelector('details')),/مع طفل/);
});
test('confirmed completion survives a subsequent detail GET network failure and preserves server fare',async()=>{
 const ride={id:'ride',status:'InProgress',version:5,pickup:'أ',destination:'ب'};let puts=0;
 const api=createDriverApi(async(path,options)=>{
  if(path.endsWith('driver/me'))return Response.json({id:'driver',status:'Busy'});
  if(path.endsWith('/status')){puts++;return Response.json({...ride,status:'Completed',version:6,finalFare:20});}
  throw Error('isolated connection loss after successful mutation');
 },{load:async()=>({token:'test',tenant:'isolated',profile:{id:'driver',status:'Busy'}}),save:async()=>{}});
 await api.bootstrap();const completed=await api.transition(ride,'Completed',20);
 assert.equal(completed.status,'Completed');assert.equal(completed.version,6);assert.equal(completed.finalFare,20);assert.equal(puts,1);
});
test('unconfirmed mutation or wrong returned identity cannot synthesize successful completion',async()=>{
 const ride={id:'ride',status:'InProgress',version:5};
 for(const confirmed of [null,{id:'other',status:'Completed',version:6}]){
  const api=createDriverApi(async(path)=>{
   if(path.endsWith('driver/me'))return Response.json({id:'driver',fullName:'سائق',status:'Busy'});
   if(path.endsWith('/status')){if(confirmed)return Response.json(confirmed);throw Error('no response');}
   throw Error('read unavailable');
  },{load:async()=>({token:'test',tenant:'isolated',profile:{id:'driver',fullName:'سائق',status:'Busy'}}),save:async()=>{}});
  await api.bootstrap();await assert.rejects(api.transition(ride,'Completed',20));
 }
});
