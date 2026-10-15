import test from 'node:test';
import assert from 'node:assert/strict';
import {customerMobile} from './helpers/customer-mobile.mjs';

const saved={id:'isolated-saved-place',label:'مكان محفوظ للاختبار',addressText:'عنوان اختبار معزول',icon:'HOME',latitude:32.3,longitude:35.3};
const ready=(h)=>{h.nodes.get('ride-form').elements.pickup.value='عنوان انطلاق يدوي';h.nodes.get('ride-form').elements.destination.value='وجهة نصية حقيقية يكتبها المستخدم';};
const readState=h=>JSON.parse(JSON.stringify(h.context.hooks.state()));

test('inline destination filters owned saved/recent data and selects coordinates without an extra request',async()=>{
  const h=await customerMobile({places:{savedPlaces:[saved],recentDestinations:[{label:'وجهة سابقة للاختبار',addressText:'وجهة سابقة للاختبار',latitude:null,longitude:null}],suggestedPlaces:[]}});
  const count=h.calls.length;const query=h.nodes.get('destination-query');query.value='اختبار';query.oninput();
  assert.equal(h.nodes.get('destination-results').children.length,2);
  query.value='محفوظ';query.oninput();assert.equal(h.nodes.get('destination-results').children.length,1);
  h.nodes.get('destination-results').children[0].children[1].onclick();
  assert.equal(h.nodes.get('ride-form').elements.destination.value,saved.addressText);assert.equal(readState(h).destinationGps.latitude,saved.latitude);assert.equal(h.nodes.get('destination-results').children.length,0);assert.equal(h.calls.length,count);
});

test('manual destination clears previous coordinates, closes picker, and manual pickup is submitted without fabricated coordinates',async()=>{
  const h=await customerMobile({places:{savedPlaces:[saved]}});h.nodes.get('destination-query').value='محفوظ';h.nodes.get('destination-query').oninput();h.nodes.get('destination-results').children[0].children[1].onclick();
  h.nodes.get('destination-query').value='وصف وجهة يكتبه الزبون';h.nodes.get('destination-query').oninput();
  assert.equal(readState(h).destinationGps,null);h.nodes.get('ride-form').elements.pickup.value='شارع يحدده الزبون';
  await h.submit('ride-form');assert.equal(h.calls.filter(c=>c.url.endsWith('/rides')).length,1);
  const body=JSON.parse(h.calls.find(c=>c.url.endsWith('/rides')).init.body);
  assert.equal(body.pickup.locationSource,'MANUAL_TEXT');assert.equal(body.pickup.latitude,undefined);assert.equal(body.destinationLocation,null);assert.equal(body.destination,'وصف وجهة يكتبه الزبون');
});

test('double confirmation and uncertain-network retry reuse one request ID and block new optimistic active requests',async()=>{
  let rejectFirst,resolveSecond;const handlers=new Map([['POST rides',()=>new Promise((_resolve,reject)=>rejectFirst=reject)]]);
  const h=await customerMobile({handlers});ready(h);
  const first=h.submit('ride-form');h.submit('ride-form');assert.equal(h.calls.filter(c=>c.url.endsWith('/rides')).length,1);assert.equal(h.nodes.get('request-ride').disabled,true);
  const firstId=JSON.parse(h.calls.find(c=>c.url.endsWith('/rides')).init.body).id;rejectFirst(Error('network unavailable'));await first;
  assert.equal(readState(h).busy,false);assert.equal(h.nodes.get('confirm-ride').disabled,false);assert.match(h.nodes.get('error').textContent,/تعذر/);
  handlers.set('POST rides',()=>new Promise(resolve=>resolveSecond=resolve));const retry=h.submit('ride-form');const posts=h.calls.filter(c=>c.url.endsWith('/rides'));assert.equal(JSON.parse(posts[1].init.body).id,firstId);
  resolveSecond({body:{id:firstId,rideStatus:'SEARCHING_DRIVER'}});await retry;assert.equal(readState(h).activeRide.id,firstId);assert.equal(h.nodes.get('ride-form').hidden,true);
  h.nodes.get('confirm-ride').onclick();assert.equal(h.calls.filter(c=>c.url.endsWith('/rides')).length,2);
});

test('opening the device restores active ride before enabling booking; terminal receipt offers an explicit clean new ride',async()=>{
  const ride={id:'own-active',pickup:'انطلاق',destination:'وجهة',rideStatus:'IN_PROGRESS',finalFare:null};const h=await customerMobile({rides:[ride]});
  assert.equal(h.nodes.get('ride-form').hidden,true);assert.equal(h.nodes.get('request-ride').disabled,true);assert.match(h.nodes.get('journey-status').textContent,/الرحلة بدأت/);
  h.state.rides=[{...ride,rideStatus:'COMPLETED',finalFare:18,currency:'ILS',driver:{fullName:'سائق الاختبار'}}];h.context.hooks.watch();await h.flush();
  assert.equal(h.nodes.get('ride-form').hidden,true);assert.match(h.text(h.nodes.get('rides').children[0]),/السعر النهائي: 18 شيكل/);
  h.nodes.get('ride-form').elements.notes.value='old';h.nodes.get('rides').children[0].children.at(-1).onclick();assert.equal(h.nodes.get('ride-form').hidden,false);assert.equal(h.nodes.get('ride-form').elements.destination.value,'');assert.equal(h.nodes.get('ride-form').elements.notes.value,'');assert.equal(h.calls.some(c=>c.init.method==='POST'&&c.url.endsWith('/rides')),false);
  h.context.hooks.watch();await h.flush();assert.equal(h.nodes.get('ride-form').hidden,false,'Old receipt must not hide the newly reset form');
});

test('status and fare labels are Arabic, arrival is prominent, and unknown statuses never leak raw enums',async()=>{
  const h=await customerMobile();
  for(const [state,label] of [['SEARCHING_DRIVER','جاري البحث عن سائق'],['OFFERED','جاري البحث عن سائق'],['DRIVER_ASSIGNED','تم قبول الطلب'],['DRIVER_ARRIVING','السائق في الطريق'],['DRIVER_ARRIVED','السائق وصل'],['IN_PROGRESS','الرحلة بدأت'],['COMPLETED','تم الوصول'],['CANCELLED','تم إلغاء الطلب']])assert.equal(h.context.hooks.card({id:'own',rideStatus:state}).children[0].textContent,label);
  const unknown=h.context.hooks.card({id:'own',rideStatus:'UNRECOGNIZED_INTERNAL_STATUS'});assert.equal(unknown.children[0].textContent,'جارٍ تحديث حالة الطلب');
  for(const fareMode of ['OFFICE_MANUAL','GPS_METER','DRIVER_MANUAL']){const card=h.context.hooks.card({id:'own',rideStatus:'COMPLETED',fareMode,finalFare:18,currency:'ILS'});assert.match(h.text(card),/18 شيكل/);assert.ok(!h.text(card).includes(fareMode));}
  const arrived=h.context.hooks.card({id:'own',rideStatus:'DRIVER_ARRIVED',driver:{fullName:'سائق'},vehicle:{plate:'test-plate',make:'test-car'}});assert.ok(arrived.classList.values.has('driver-arrived'));assert.match(h.text(arrived),/test-plate/);
});

test('GPS loading, permission denial, approximate accuracy and invalid observations are explicit; metadata is retained',async()=>{
  const h=await customerMobile();let ok,fail;h.context.navigator.geolocation={getCurrentPosition(success,error){ok=success;fail=error;}};
  h.nodes.get('locate').onclick();assert.match(h.nodes.get('gps-note').textContent,/جارٍ تحديد/);assert.equal(h.nodes.get('locate').disabled,true);fail({code:1});assert.match(h.nodes.get('error').textContent,/لم يتم السماح/);assert.equal(readState(h).gps,null);
  h.nodes.get('locate').onclick();ok({coords:{latitude:32.2,longitude:35.2,accuracy:250},timestamp:Date.now()});assert.match(h.nodes.get('gps-note').textContent,/تقريبي/);assert.equal(readState(h).gps.accuracy,250);assert.ok(readState(h).gps.timestamp);
  h.nodes.get('locate').onclick();ok({coords:{latitude:100,longitude:35.2,accuracy:8},timestamp:Date.now()});assert.equal(readState(h).gps.latitude,32.2,'Invalid GPS must not replace a valid previous point');assert.match(h.nodes.get('error').textContent,/موقع صالح/);
});

test('map selection is draft-only, cancel preserves prior point, and manual confirmation wins over a delayed GPS callback',async()=>{
  const h=await customerMobile();let gpsCallback;h.context.navigator.geolocation={getCurrentPosition(ok){gpsCallback=ok;}};h.nodes.get('locate').onclick();
  h.nodes.get('pick-pickup').onclick();await h.flush();assert.equal(h.maps[0].point,null);assert.equal(h.nodes.get('confirm-map').disabled,true);
  h.maps[0].onPick({latitude:32.1,longitude:35.1,locationSource:'MAP_PIN'});assert.equal(readState(h).gps,null);h.nodes.get('confirm-map').onclick();assert.equal(readState(h).gps.latitude,32.1);
  gpsCallback({coords:{latitude:32.9,longitude:35.9,accuracy:8},timestamp:Date.now()});assert.equal(readState(h).gps.latitude,32.1);
  h.nodes.get('pick-pickup').onclick();await h.flush();h.maps[1].onPick({latitude:32.4,longitude:35.4,locationSource:'MAP_PIN'});h.nodes.get('close-map').onclick();assert.equal(readState(h).gps.latitude,32.1);assert.equal(h.maps[1].map.removed,true);
});

test('places load failure leaves free text available, retry is batched, and no unconfigured geocoding/office API is called',async()=>{
  const handlers=new Map([['GET places',async()=>({status:500,body:{detail:'Internal server error'}})]]);const h=await customerMobile({handlers});h.nodes.get('open-destination').onclick();await h.flush();
  assert.equal(h.nodes.get('places-error').hidden,false);assert.equal(h.nodes.get('retry-places').hidden,false);assert.equal(h.nodes.get('suggested-shortcuts').hidden,true);
  h.nodes.get('destination-query').value='manual';h.nodes.get('destination-query').oninput();h.nodes.get('use-destination-text').onclick();assert.equal(h.nodes.get('ride-form').elements.destination.value,'manual');
  handlers.set('GET places',async()=>({body:{savedPlaces:[saved]}}));await h.context.hooks.loadPlaces(true);assert.equal(h.nodes.get('saved-chips').children.length,1);
  assert.ok(h.calls.every(c=>c.url.startsWith('/api/customer/')));assert.ok(h.calls.every(c=>!c.url.includes('geocod')&&!c.url.includes('driver-map')));
});

test('save place uses existing customer transport, includes no customer/tenant override, and double tap issues one write',async()=>{
  let release;const handlers=new Map([['POST places',()=>new Promise(resolve=>release=resolve)]]);const h=await customerMobile({handlers});ready(h);h.nodes.get('destination-query').oninput();assert.equal(h.nodes.get('save-destination').hidden,false);h.nodes.get('save-destination').onclick();const form=h.nodes.get('save-place-form');form.elements.label.value='اسمي للمكان';
  const first=h.submit('save-place-form');h.submit('save-place-form');const posts=h.calls.filter(c=>c.init.method==='POST'&&c.url.endsWith('/places'));assert.equal(posts.length,1);
  const body=JSON.parse(posts[0].init.body);assert.equal(body.label,'اسمي للمكان');assert.equal(body.customerId,undefined);assert.equal(body.tenantId,undefined);assert.equal(body.latitude,null);
  release({body:{id:body.id}});await first;assert.match(h.nodes.get('save-place-note').textContent,/تم حفظ/);
});

test('Escape closes destination sheet and locking account discards coordinates and loaded personal places',async()=>{
  const h=await customerMobile({places:{savedPlaces:[saved]}});h.nodes.get('open-destination').onclick();h.events.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(h.nodes.get('destination-picker').hidden,true);
  h.context.hooks.lock();assert.equal(readState(h).gps,null);assert.equal(readState(h).destinationGps,null);assert.deepEqual(readState(h).placesData.savedPlaces,[]);assert.equal(h.nodes.get('account').hidden,true);
});
