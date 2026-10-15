import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeDriverRide,normalizeDriverSnapshot,DriverPayloadError} from '../src/lib/driver-payload.js';
import {driverTrace,driverDiagnostics} from '../src/lib/driver-runtime-diagnostics.js';
import {createDriverApi} from '../src/lib/driver-api.ts';
import {registerHooks} from 'node:module';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('missing optional trip fields and malformed optional values cannot enter React as objects',()=>{
 const ride=normalizeDriverRide({id:'fresh',status:'InProgress',version:4,pickup:null,destination:{name:'bad'},phone:{secret:'not-a-string'},fullName:null,notes:[],finalFare:Infinity,distanceKm:null,latitude:999,longitude:35});
 assert.equal(ride.destination,'');assert.equal(ride.phone,'');assert.equal(ride.fullName,'');assert.equal(ride.notes,'');assert.equal(ride.finalFare,null);assert.equal(ride.latitude,null);
 assert.throws(()=>normalizeDriverRide({id:'fresh',version:4,status:'UNEXPECTED'}),DriverPayloadError);
 assert.throws(()=>normalizeDriverSnapshot({driver:{id:'driver',status:'Busy'},rides:null}),DriverPayloadError);
 const snapshot=normalizeDriverSnapshot({driver:{id:'driver',status:'Busy',fullName:null},rides:[{id:'fresh',version:1,status:'Accepted'}],notices:null,jobs:[null,{id:'queued',pickup:{bad:1},destination:null}]});
 assert.deepEqual(snapshot.notices,[]);assert.equal(snapshot.jobs[0].pickup,'');assert.equal('phone' in snapshot.rides[0],false,'Public snapshots must not overwrite private hydrated fields');
});
test('Start Trip ignores mutation entity for presentation and hydrates from authorized backend GET',async()=>{
 const requests=[];const storage={load:async()=>null,save:async()=>{}};
 const api=createDriverApi(async(url,init)=>{requests.push({url,method:init.method});if(url.endsWith('auth/driver-login'))return Response.json({accessToken:'fixture',tenant:'fixture'});if(url.endsWith('driver/me'))return Response.json({id:'driver',status:'Available'});if(init.method==='PUT')return Response.json({id:'fresh',status:'InProgress',version:9});return Response.json({id:'fresh',status:'InProgress',version:9,pickup:null,destination:null,phone:'0591234567',fareMode:'GPS_METER',meterCalculatedFare:null,distanceKm:null});},storage);
 await api.login('fixture','driver','fixture');const ride=await api.transition({id:'fresh',status:'Arrived',version:8},'InProgress');
 assert.equal(ride.status,'InProgress');assert.equal(ride.phone,'0591234567');assert.equal(ride.destination,'');assert.deepEqual(requests.slice(-2),[{url:'/api/reception/rides/fresh/status',method:'PUT'},{url:'/api/reception/driver/rides/fresh',method:'GET'}]);
});
test('render exception produces Arabic recovery and retries without page reload',async()=>{
 const hooks=receptionRenderHooks();let renderer,recoveries=0,broken=true;
 try{const {DriverErrorBoundary}=await import('../src/components/driver-error-boundary.tsx');const Child=()=>{if(broken)throw new TypeError('fixture render fault');return React.createElement('div',null,'حالة الرحلة');};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(DriverErrorBoundary,{onRecover:()=>{recoveries++;broken=false;}},React.createElement(Child)));});
 assert.match(JSON.stringify(renderer.toJSON()),/تعذر عرض واجهة الرحلة/);assert.match(JSON.stringify(renderer.toJSON()),/TypeError/);assert.equal(renderer.root.findAllByType('button').length,2);
 await act(async()=>renderer.root.findAllByType('button')[0].props.onClick());assert.equal(recoveries,1);assert.match(JSON.stringify(renderer.toJSON()),/حالة الرحلة/);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});
test('diagnostic trace keeps state and source positions but never raw message, payload or token',()=>{
 driverTrace('render-failed',{status:'InProgress',kind:'TypeError',stack:'TypeError: Bearer SECRET passenger phone at https://appassets.androidplatform.net/app.js:1:8765',message:'SECRET',token:'SECRET',phone:'0591234567'});
 const serialized=JSON.stringify(driverDiagnostics());assert.ok(serialized.includes('app.js:1:8765'));assert.ok(serialized.includes('InProgress'));assert.ok(!serialized.includes('SECRET'));assert.ok(!serialized.includes('0591234567'));
});
test('Recovery snapshot reads do not replay queued state mutations or erase pending intent',async()=>{
 const ride={id:'recovery-ride',status:'Arrived',version:1},profile={id:'recovery-driver',status:'Busy'},requests=[];
 let saved={token:'fixture-only',tenant:'qa-only',profile,outbox:[{id:'pending',path:'rides/recovery-ride/status',body:{status:'InProgress',version:1},rideId:ride.id,version:1,status:'InProgress',createdAt:Date.now()}]};
 const api=createDriverApi(async(path,init)=>{requests.push({path,method:init.method});if(path.endsWith('driver/me'))return Response.json(profile);if(path.includes('driver/updates'))return Response.json({cursor:'current',data:{driver:profile,rides:[ride],notices:[],jobs:[]}});return Response.json(ride);},{load:async()=>saved,save:async value=>{saved=value;}});
 await api.updates('',undefined,{reconcileOnly:true});assert.equal(api.pendingCount(),1);assert.equal(requests.filter(r=>r.method==='PUT').length,0);
 await api.updates();assert.equal(requests.filter(r=>r.method==='PUT').length,1,'Normal operation retains verified outbox delivery');assert.equal(api.pendingCount(),0);
});
