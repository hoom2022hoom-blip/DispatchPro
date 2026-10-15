import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('office queues busy drivers, moves/reorders/removes with current versions',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.jobTestApi;',shortCircuit:true};return next(s,c);}});
 let jobs=[{id:'j1',rideId:'r1',driverId:'busy',version:4,position:1,pickup:'الأول'},{id:'j2',rideId:'r2',driverId:'busy',version:7,position:2,pickup:'الثاني'}],renderer;
 const calls=[];globalThis.jobTestApi={jobs:async()=>jobs.map(j=>({...j})),changeJob:async value=>{calls.push(value);}};
 try{
  const {OfficeDriverJobs}=await import('../src/components/office-driver-jobs.tsx');
  const props={rides:[{id:'new',backendRideId:'r3',rideVersion:9,status:'pending',pickup:{name:'الثالث'}}],drivers:[{id:'busy',fullName:'مشغول',active:true,status:'Busy'},{id:'other',fullName:'آخر',active:true,status:'Available'}],refresh:async()=>{}};
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeDriverJobs,props));});
  const label=value=>renderer.root.findByProps({'aria-label':value});
  await act(async()=>label('سائق طابور الرحلات').props.onChange({target:{value:'busy'}}));
  assert.equal(renderer.root.findAllByType('li').length,2);
  await act(async()=>label('تقديم الطلب 2').props.onClick());
  assert.deepEqual(calls.at(-1),{type:'move',rideId:'r2',version:7,driverId:'busy',position:1});
  await act(async()=>label('نقل الطلب 1 إلى سائق').props.onChange({target:{value:'other'}}));
  assert.deepEqual(calls.at(-1),{type:'move',rideId:'r1',version:4,driverId:'other'});
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='إزالة من الطابور').props.onClick());
  assert.deepEqual(calls.at(-1),{type:'remove',rideId:'r1',version:4});
  await act(async()=>label('طلب لإضافته للطابور').props.onChange({target:{value:'r3'}}));
  const add=renderer.root.findAllByType('button').find(b=>b.children.join('')==='إضافة للطابور');assert.equal(add.props.disabled,false);
  await act(async()=>add.props.onClick());assert.deepEqual(calls.at(-1),{type:'add',rideId:'r3',driverId:'busy',version:9});
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.jobTestApi;}
});
