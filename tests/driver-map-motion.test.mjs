import test from 'node:test';
import assert from 'node:assert/strict';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const hooks=receptionRenderHooks();
const {gpsMotion,bearingLabel,operationalStatus,liveLocation,lastKnownLocation,routeSegments}=await import('../src/lib/office-driver-map.ts');
hooks.deregister();
const point=(latitude,longitude,seconds=0,accuracy=3)=>({latitude,longitude,timestamp:new Date(1700000000000+seconds*1000).toISOString(),accuracy});
test('validated consecutive GPS yields speed and cardinal bearing; rejects bad observations',()=>{
 const a=point(32,35),b=point(32.001,35,20);const m=gpsMotion(a,b);
 assert.ok(m.speed>19&&m.speed<21);assert.equal(m.bearing,0);assert.equal(bearingLabel(m.bearing),'شمال');
 assert.equal(gpsMotion(null,b),null);assert.equal(gpsMotion(a,a),null);
 assert.equal(gpsMotion(a,point(32.001,35,-1)),null);assert.equal(gpsMotion(a,point(32.001,35,61)),null);
 assert.equal(gpsMotion(a,point(32.001,35,20,51)),null);assert.equal(gpsMotion(a,point(33,35,20)),null);
 assert.equal(gpsMotion(a,point(NaN,35,20)),null);
 assert.deepEqual(gpsMotion(a,point(32.00001,35,20)),{meters:0,speed:0,bearing:null});
 assert.equal(gpsMotion(a,point(32,35,20)).speed,0);
 for(const [lat,lon,label] of [[32,35.001,'شرق'],[31.999,35,'جنوب'],[32,34.999,'غرب'],[32.001,35.001,'شمال شرق']])assert.equal(bearingLabel(gpsMotion(a,point(lat,lon,20)).bearing),label);
});
test('actual operational enums retain colors independently of freshness and connectivity',()=>{
 const base={active:true,status:'Available',waitingCount:0,currentRide:null,locationStatus:'FRESH',location:{...point(32,35),updatedAt:point(32,35).timestamp}};
 for(const [status,color] of [['Assigned','text-yellow-500'],['Accepted','text-yellow-600'],['DriverArriving','text-yellow-500'],['Arrived','text-yellow-600'],['InProgress','text-blue-600']]){
  const d={...base,currentRide:{status}};assert.equal(operationalStatus(d).color,color);assert.equal(liveLocation(d,1700000121000,120),null);assert.ok(lastKnownLocation(d));assert.equal(operationalStatus(d).color,color);
 }
 assert.equal(operationalStatus(base).color,'text-emerald-600');assert.equal(operationalStatus({...base,status:'Offline'}).color,'text-red-600');
 assert.equal(lastKnownLocation({...base,location:null}),null);assert.ok(liveLocation(base,1700000120000,120));assert.equal(liveLocation(base,1700000120001,120),null);
});
test('history lines and distance accept only valid segments without bridging rejected points',()=>{
 const points=[point(32,35),point(32.001,35,20),point(33,35,40),point(32.002,35,60)];assert.equal(routeSegments(points).geometry.coordinates.length,1);
});
