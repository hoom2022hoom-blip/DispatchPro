import test from 'node:test';
import assert from 'node:assert/strict';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const hooks=receptionRenderHooks();
const {headingTarget,targetDistance,gpsAgeLabel,matchesMapDriver,matchesOperationFilter,operationalStatus}=await import('../src/lib/office-driver-map.ts');
hooks.deregister();
const now=Date.now(),at=new Date(now).toISOString();
const base={id:'d',fullName:'أحمد',active:true,status:'Available',waitingCount:3,currentRide:null,vehicle:{id:'v',plate:'1234-9',active:true,status:'ACTIVE'},locationStatus:'FRESH',location:{latitude:32,longitude:35,accuracy:8,updatedAt:at}};
const order={id:'r',orderId:'office-1542',orderNumber:1542,status:'DriverArriving',pickup:'شارع القدس',pickupLatitude:32.01,pickupLongitude:35,destination:'رفيديا',destinationLatitude:32.03,destinationLongitude:35};
test('current order changes target from pickup to destination; future jobs do not imply a current order',()=>{
 assert.equal(headingTarget(base).label,'لا توجد وجهة حالية');assert.equal(operationalStatus(base).status,'Available');
 const arriving={...base,currentRide:order};assert.equal(headingTarget(arriving).label,'متجه إلى شارع القدس');assert.ok(targetDistance(arriving,now,120)>1);
 const trip={...arriving,currentRide:{...order,status:'InProgress'}};assert.equal(headingTarget(trip).label,'متجه إلى رفيديا');assert.ok(targetDistance(trip,now,120)>3);
 assert.equal(operationalStatus(trip).color,'text-blue-600');assert.equal(operationalStatus(arriving).color,'text-yellow-500');
 assert.equal(operationalStatus({...trip,status:'Offline'}).status,'Offline');assert.equal(operationalStatus({...trip,active:false}).status,'Offline');
});
test('five filters and vehicle search use driver identity; stale GPS does not produce a distance',()=>{
 assert.ok(matchesMapDriver(base,'1234'));assert.ok(matchesMapDriver(base,'أحمد'));assert.ok(!matchesMapDriver(base,'غير موجود'));
 assert.ok(matchesOperationFilter({...base,currentRide:order},'DriverArriving'));assert.ok(!matchesOperationFilter(base,'InProgress'));
 assert.equal(targetDistance({...base,currentRide:order},now+121000,120),null);assert.equal(targetDistance({...base,currentRide:{...order,pickupLatitude:NaN}},now,120),null);
 assert.equal(gpsAgeLabel(base,now+5000),'قبل 5 ثانية');assert.equal(gpsAgeLabel({...base,location:null},now),'غير متاح');
});
