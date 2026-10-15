import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('destination-only form writes existing version, accepts free text, real points and clears stale coordinates',async()=>{
 const hooks=receptionRenderHooks();let view;const writes=[];
 try{
  const {DriverStartDestination}=await import('../src/components/driver-start-destination.tsx');const {OfficeOrderDestination}=await import('../src/components/office-order-destination.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverStartDestination,{ride:{id:'same',version:7,destination:''},places:async()=>[],save:async r=>writes.push(r),onClose(){}}));});
  assert.equal(view.root.findAllByType('input').length,1);
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes.length,0);assert.match(JSON.stringify(view.toJSON()),/يرجى تحديد الوجهة قبل بدء الرحلة/);
  for(const [label,point]of [['شارع فيصل مقابل البنك',undefined],['رفيديا',{latitude:32.24,longitude:35.27}],['وجهة على الخريطة',{latitude:32.26,longitude:35.28}],['نص بعد اختيار نقطة',undefined]]){
   await act(async()=>view.root.findByType(OfficeOrderDestination).props.onChange(label,point));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
   assert.deepEqual(writes.at(-1),{version:7,destination:{addressText:label,...point,locationSource:point?'MAP_PIN':'MANUAL_TEXT'}});assert.equal(writes.at(-1).pickup,undefined);
  }
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('actual start button starts office rides with or without destination without a mandatory form',async()=>{
 const hooks=receptionRenderHooks();const apiHook=registerHooks({resolve(s,c,next){if(s==='@/lib/driver-api')return{url:'data:text/javascript,export const createDriverApi=()=>globalThis.startDestinationApi;export class DriverApiError extends Error{};export const noticeLabel=()=>"";',shortCircuit:true};return next(s,c);}});
 const oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});let view;
 try{
  const {DriverApiDashboard}=await import('../src/components/driver-api-dashboard.tsx');const {DriverStartDestination}=await import('../src/components/driver-start-destination.tsx');
  for(const destination of ['', 'Office supplied destination']){
   const ride={id:'same',status:'Arrived',source:'MANUAL',version:3,pickup:'',destination};const transitions=[];const profile={id:'driver',fullName:'Driver',status:'Busy'};
   globalThis.startDestinationApi={login:async()=>profile,updates:async()=>({data:{driver:profile,rides:[ride],jobs:[],notices:[]}}),ride:async()=>ride,transition:async(...args)=>transitions.push(args),offerNow:()=>Date.now(),places:async()=>[],logout(){}};
   await act(async()=>{view=TestRenderer.create(React.createElement(DriverApiDashboard));});await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
   await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='بدء الرحلة').props.onClick());
   assert.equal(view.root.findAllByType(DriverStartDestination).length,0);assert.equal(transitions.length,1);assert.equal(transitions[0][1],'InProgress');
   await act(async()=>view.unmount());view=null;
  }
 }finally{await act(async()=>view?.unmount());apiHook.deregister();hooks.deregister();delete globalThis.startDestinationApi;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});

test('QA actual buttons play no acceptance on HTTP failure and only one acceptance in a full silent journey',async()=>{
 const hooks=receptionRenderHooks();const apiHook=registerHooks({resolve(s,c,next){if(s==='@/lib/driver-api')return{url:'data:text/javascript,export const createDriverApi=()=>globalThis.startDestinationApi;export class DriverApiError extends Error{};export const noticeLabel=()=>"";',shortCircuit:true};return next(s,c);}});
 const oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});let view;
 const oldDocument=globalThis.document;globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const events=[];globalThis.dispatchProDriverQa=true;globalThis.dispatchProCallNative=async(type,data)=>events.push({type,data});
 try{
  const {DriverApiDashboard}=await import('../src/components/driver-api-dashboard.tsx');let fail=true;
  let ride={id:'same',status:'Assigned',source:'MANUAL',version:3,pickup:'QA only',destination:'',finalFare:25};const profile={id:'driver',fullName:'QA',status:'Busy'};
  globalThis.startDestinationApi={login:async()=>profile,updates:async()=>({data:{driver:{...profile,status:ride.status==='Completed'?'Available':'Busy'},rides:ride.status==='Completed'?[]:[ride],jobs:[],notices:[]}}),ride:async()=>ride,transition:async(r,status)=>{if(fail)throw Error('Test HTTP 503');return ride={...ride,status,version:ride.version+1};},offerNow:()=>Date.now(),places:async()=>[],logout(){}};
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverApiDashboard));});await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  const click=async label=>act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')===label).props.onClick());
  await click('قبول');assert.deepEqual(events.filter(e=>e.type==='sound.event').map(e=>e.data.kind),['error']);
  fail=false;for(const label of ['قبول','في الطريق إلى الزبون','وصلت للزبون','بدء الرحلة','إنهاء الرحلة'])await click(label);
  assert.deepEqual(events.filter(e=>e.type==='sound.event').map(e=>e.data.kind),['error','accepted']);assert.equal(ride.status,'Completed');assert.equal(ride.destination,'');
 }finally{await act(async()=>view?.unmount());apiHook.deregister();hooks.deregister();for(const name of ['startDestinationApi','dispatchProDriverQa','dispatchProCallNative'])delete globalThis[name];globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
