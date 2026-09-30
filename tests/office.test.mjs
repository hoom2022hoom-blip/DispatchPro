import test from 'node:test';
import assert from 'node:assert/strict';
import {officeMetrics,officeDriverStatus,searchDrivers,driverVehicle,vehicleLabel} from '../src/lib/office.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
test('office metrics count business day and real busy rides, including drivers with no shift',()=>{
 const data={today:'2026-09-27',drivers:[{id:'a',active:true,status:'Available'},{id:'b',active:true,status:'Offline'},{id:'c',active:false,status:'Available'}],vehicles:[{}],reception:{shifts:[],rides:[{orderDay:'2026-09-27',status:'completed'},{orderDay:'2026-09-26',status:'in-progress',driverId:'b'},{orderDay:'2026-09-27',status:'pending'}]}};
 assert.equal(officeDriverStatus(data.drivers[1],data),'BUSY');assert.equal(officeDriverStatus(data.drivers[2],data),'OFFLINE');assert.deepEqual(officeMetrics(data),{today:2,active:2,available:1,busy:1,vehicles:1,completed:1});
});

test('driver search uses local phone, identity, name and current plate rather than historical links',()=>{
 const driver={id:'d',fullName:'محمد أحمد',phoneLocal:'0591234567',nationalId:'123456789',currentVehicleId:'new',active:true,status:'Suspended'};
 const data={drivers:[driver],vehicles:[{id:'old',driverId:'d',plate:'OLD',make:'Old',model:'Car'},{id:'new',driverId:'d',plate:'39-123-45',make:'Kia',model:'Niro'}],reception:{rides:[],shifts:[]}};
 for(const query of ['محمد','059123','123456789','39-123-45']) assert.deepEqual(searchDrivers(data,query),[driver]);
 assert.deepEqual(searchDrivers(data,'OLD'),[]);
 assert.equal(vehicleLabel(driverVehicle(driver,data)),'39-123-45 | Kia Niro');
 assert.equal(officeDriverStatus(driver,data),'SUSPENDED');
});

test('queue, history and local messaging settings stay behind the authenticated office proxy',async()=>{
 const root='http://localhost:9005/api/reception/'; const id='11111111-1111-1111-1111-111111111111';
 for(const [route,method] of [['office/queue','POST'],['office/queue-locations','POST'],[`office/queue-locations/${id}`,'PUT'],[`office/drivers/${id}/assignments`,'GET'],['office/messaging-settings','PUT']]) {
  const request=new Request(root+route,{method,headers:{Authorization:'Bearer dispatcher'}});
  assert.equal((await proxyReception(request,route.split('/'),'http://127.0.0.1:9010',async()=>Response.json({}))).status,200);
  assert.equal((await proxyReception(new Request(root+route,{method}),route.split('/'),'http://127.0.0.1:9010')).status,401);
 }
});
test('office proxy allows only explicitly supported management routes and keeps token/origin checks',async()=>{
 let count=0;const fetcher=async()=>{count++;return Response.json({});};const root='http://localhost:9005/api/reception/';const base='http://127.0.0.1:9010';
 const req=(route,method='GET',headers={Authorization:'Bearer employee'})=>proxyReception(new Request(root+route,{method,headers}),route.split('/'),base,fetcher);
 assert.equal((await req('office')).status,200);assert.equal((await req('office/drivers','POST')).status,200);assert.equal((await req('office/users','POST')).status,404);assert.equal((await req('office','GET',{})).status,401);assert.equal((await req('office','GET',{Authorization:'Bearer employee',Origin:'https://evil.test'})).status,403);assert.equal(count,2);
});
