import test from 'node:test';
import assert from 'node:assert/strict';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('customer shell binds map pickers, commits real points and renders actual assigned ride states',async()=>{
 const app=await customerMobile();const {nodes,context,maps}=app;
 assert.equal(typeof nodes.get('pick-pickup').onclick,'function');assert.equal(typeof nodes.get('pick-destination').onclick,'function');
 await context.hooks.pickLocation('pickup');maps[0].onPick({latitude:32.22,longitude:35.25,locationSource:'MAP_PIN'});
 assert.equal(context.hooks.state().gps,null,'Draft points require confirmation');nodes.get('confirm-map').onclick();
 await context.hooks.pickLocation('destination');maps[1].onPick({latitude:32.23,longitude:35.27,locationSource:'MAP_PIN'});
 assert.equal(context.hooks.state().destinationGps,null);nodes.get('confirm-map').onclick();
 assert.equal(context.hooks.state().gps.latitude,32.22);assert.equal(context.hooks.state().destinationGps.longitude,35.27);
 context.navigator.geolocation={getCurrentPosition(ok){ok({coords:{latitude:32.24,longitude:35.28,accuracy:8},timestamp:Date.now()});}};
 nodes.get('locate').onclick();assert.equal(context.hooks.state().gps.latitude,32.24);assert.equal(nodes.get('locate').disabled,false);
 context.navigator.geolocation={getCurrentPosition(_ok,fail){fail({code:1});}};nodes.get('locate').onclick();assert.equal(nodes.get('locate').disabled,false);assert.match(nodes.get('error').textContent,/لم يتم السماح بالوصول إلى الموقع/);
 const ride={id:'ride',status:'ACCEPTED',createdAt:new Date().toISOString(),pickup:'A',destination:'B',driver:{fullName:'Driver'},tracking:{latitude:32.22,longitude:35.25,etaMinutes:3,updatedAt:new Date().toISOString()}};
 assert.doesNotMatch(app.text(context.hooks.card(ride)),/الوصول التقريبي/);assert.match(app.text(context.hooks.card({...ride,tracking:{...ride.tracking,etaSource:'ROUTE'}})),/الوصول التقريبي: 3/);context.hooks.card({...ride,tracking:{...ride.tracking,longitude:35.26}});assert.equal(maps.length,2,'Cards reuse the shared journey map');
 for(const [workflowStatus,label] of [['DRIVER_ASSIGNED','تم قبول الطلب'],['DRIVER_ARRIVING','السائق في الطريق'],['DRIVER_ARRIVED','السائق وصل'],['IN_TRIP','الرحلة بدأت'],['REJECTED','جاري البحث عن سائق']])assert.equal(context.hooks.card({...ride,workflowStatus,tracking:null}).children[0].textContent,label);
});
