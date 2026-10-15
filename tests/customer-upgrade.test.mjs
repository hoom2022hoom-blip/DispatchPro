import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {customerMobile} from './helpers/customer-mobile.mjs';
import {proxyCustomer} from '../src/lib/customer-proxy.ts';

test('arrival rings/vibrates once per backend event and never on a guessed state',async()=>{
 const h=await customerMobile();let rings=0,vibrations=0;
 h.context.testAudio={state:'running',currentTime:0,destination:{},createOscillator(){rings++;return{frequency:{},connect(){},start(){},stop(){}};},createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}};
 h.context.navigator.vibrate=()=>vibrations++;
 vm.runInContext('audio=testAudio',h.context);
 const event={rideStatus:'DRIVER_ARRIVED',arrivalEventId:'11111111-1111-1111-1111-111111111111'};
 h.context.hooks.notifyArrival({...event,rideStatus:'ACCEPTED'});h.context.hooks.notifyArrival({...event,arrivalEventId:null});assert.equal(rings,0);
 h.context.hooks.notifyArrival(event);h.context.hooks.notifyArrival(event);assert.equal(rings,3);assert.equal(vibrations,1);
 h.context.hooks.lock();h.context.hooks.notifyArrival(event);assert.equal(rings,3);
});
test('malformed successful order response never becomes an optimistic active ride; retry keeps ID',async()=>{
 const h=await customerMobile({handlers:new Map([['POST rides',()=>({body:{}})]])});const form=h.nodes.get('ride-form');form.elements.pickup.value='الانطلاق';form.elements.destination.value='الجامعة';
 await h.submit('ride-form');assert.equal(h.context.hooks.state().activeRide,null);assert.match(h.nodes.get('error').textContent,/تعذر تأكيد/);
 const first=JSON.parse(h.calls.find(c=>c.url.endsWith('/rides')).init.body).id;await h.submit('ride-form');assert.equal(JSON.parse(h.calls.filter(c=>c.url.endsWith('/rides'))[1].init.body).id,first);
});
test('no missing fare or invented ETA, and all technical failures become safe Arabic',async()=>{
 const h=await customerMobile();const card=h.context.hooks.card({status:'ACCEPTED',driver:{fullName:'سائق'},tracking:{etaMinutes:4},finalFare:null,meterCalculatedFare:null});assert.doesNotMatch(h.text(card),/السعر|الوصول التقريبي/);
 const request=new Request('https://customer.test/api/customer/push-device',{method:'POST',headers:{Authorization:'Bearer test-only'},body:'{}'});
 const result=await proxyCustomer(request,['push-device'],'https://backend.test',async()=>Response.json({detail:'HTTP 403 JWT secret StackTrace Exception'},{status:403}));
 assert.equal(result.status,403);assert.deepEqual(await result.json(),{detail:'تعذر إكمال العملية، حاول مرة أخرى.'});
});
