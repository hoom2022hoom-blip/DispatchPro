const officeAuthFixture={authReady:true,authenticated:true,tenant:"test"};
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('send uses the driver field, missing selection focuses without opening, suppresses duplicates and preserves phone privacy',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){if(s==='./shift-picker')return {url:'data:text/javascript,export const ShiftPicker="driver-picker";',shortCircuit:true};return next(s,c);}});
 let renderer,release;const calls=[];
 try{
  const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
  const ride={id:'r',orderNumber:1,createdAt:new Date(),status:'pending',passengerName:'عميل',pickup:{name:'عنوان'}};
  const props={rides:[ride],drivers:[{id:'busy',name:'محمد'}],choices:[],sendChoices:[{id:'busy',driverId:'busy',label:'محمد'}],onSend:async(...args)=>{calls.push(args);await new Promise(r=>release=r);},onAssign:async()=>{},onSave:async()=>{},onEdit:()=>{},onDuplicate:async()=>{}};
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeReceptionTable,props));});
  let focused=0;const event={currentTarget:{closest:()=>({querySelector:()=>({focus:()=>focused++})})}};
  const {SendPhoneMenu}=await import('../src/components/send-phone-menu.tsx');
  await act(async()=>renderer.root.findByType(SendPhoneMenu).props.onMissing(event.currentTarget));
  assert.equal(renderer.root.findAllByType('driver-picker').some(p=>p.props.initialOpen),false);
  assert.equal(focused,1);assert.equal(calls.length,0);assert.ok(JSON.stringify(renderer.toJSON()).includes('اختر السائق أولًا'));
  await act(async()=>renderer.update(React.createElement(OfficeReceptionTable,{...props,rides:[{...ride,driverId:'busy'}]})));
  assert.equal(renderer.root.findAllByProps({'aria-label':'إظهار رقم العميل للسائق'}).length,0);
  const send=renderer.root.findByType(SendPhoneMenu);
  await act(async()=>{void send.props.onSend(false);void send.props.onSend(false);});
  assert.deepEqual(calls,[['r','busy',false]]);assert.equal(renderer.root.findAllByType('driver-picker').length,1);
  assert.ok(JSON.stringify(renderer.toJSON()).includes('جارٍ الإرسال'));await act(async()=>{release();await new Promise(setImmediate);});
  for(const position of [1,2]){
   await act(async()=>renderer.update(React.createElement(OfficeReceptionTable,{...props,rides:[{...ride,queuedDriverId:'busy',jobPosition:position}]})));
   assert.ok(JSON.stringify(renderer.toJSON()).includes(`انتظار `));
   assert.equal(renderer.root.findAllByType('small').some(n=>n.children.join('')===`محمد | انتظار ${position}`),true);
   assert.equal(renderer.root.findAllByType('button').find(b=>b.children.join('')==='إرسال').props.disabled,true);
  }
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();}
});

test('connected drivers sort by availability, pending acceptance, busy and offline with stable ids and refresh counts',async()=>{
 const hooks=receptionRenderHooks();let renderer;
 try{
  const {ConnectedDrivers}=await import('../src/components/connected-drivers.tsx');
  const drivers=[{id:'z',fullName:'غير متصل',active:true,status:'Offline'},{id:'c',fullName:'مشغول',active:true,status:'Busy'},{id:'b',fullName:'عرض',active:true,status:'Available'},{id:'a2',fullName:'متاح ثاني',active:true,status:'Available'},{id:'a1',fullName:'متاح أول',active:true,status:'Available'}];
  const rides=[{driverId:'b',status:'assigned'},{driverId:'c',status:'in-progress'},{queuedDriverId:'c'},{queuedDriverId:'c'}];
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ConnectedDrivers,{drivers,rides}));});
  assert.deepEqual(renderer.root.findAllByType('li').map(n=>n.props.title),['متاح أول','متاح ثاني','عرض','مشغول','غير متصل']);
  await act(async()=>renderer.update(React.createElement(ConnectedDrivers,{drivers,rides:[{driverId:'c',status:'assigned'},{queuedDriverId:'c'}]})));
  assert.equal(renderer.root.findByProps({'aria-label':'بانتظار القبول'}).findByType('li').props.title,'مشغول');assert.ok(JSON.stringify(renderer.toJSON()).includes('انتظار '));
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

test('reception sends once, refreshes after conflicts and live updates, and keeps the traditional queue independent',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){
  const sources={
   '@/lib/reception-api':'export const apiReceptionBackend=globalThis.sendQueueApi; export const decodeReceptionSnapshot=x=>x;',
   '@/lib/reception-backend':'export const getReceptionBackend=()=>({saveRide:async()=>{}});',
   './dispatch-monitor':'export const DispatchMonitor=()=>null;',
   './office-driver-jobs':'export const OfficeDriverJobs=()=>null;',
   './floating-queue-window':`export const FloatingQueueWindow=p=>p.open?p.children:null;`,
   './office-queue':'export const OfficeQueuePanel="traditional-queue";export const reorderOfficeQueue=async()=>{};',
  };if(sources[s])return {url:'data:text/javascript,'+encodeURIComponent(sources[s]),shortCircuit:true};return next(s,c);
 }});
 let renderer,live,release,reads=0;const sent=[];
 const call={eventId:'call-1',phone:'0599000000',source:'WHATSAPP',timestamp:'2026-10-01T08:00:00Z'};
 const ride={id:'r',callEventId:call.eventId,backendRideId:'ride-id',rideVersion:3,status:'pending',pickup:{name:'عنوان'}};
 const reception={rides:[ride],drivers:[],vehicles:[],shifts:[],queue:[],latest:null};
 const data={drivers:[{id:'busy',fullName:'محمد',active:true,status:'Busy'}],vehicles:[],reception};
 globalThis.sendQueueApi={authSnapshot:()=>officeAuthFixture,subscribeAuth:()=>()=>{},bootstrap:async()=>{},getLatestCall:()=>call,subscribeLatest:()=>()=>{},watchLatest:()=>()=>{},subscribe:next=>{live=next;next(reception);return ()=>{};},office:async()=>{reads++;return data;},changeJob:async action=>{sent.push(action);await new Promise(r=>release=r);}};
 try{
  const {ApiReception}=await import('../src/components/api-reception.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ApiReception,{officeTenant:'test'}));});
  const table=()=>renderer.root.findByType('reception-table');
  assert.equal(table().props.sendChoices[0].id,'busy');
  const lastCall=renderer.root.findByProps({'aria-label':'آخر مكالمة'});
  assert.equal(lastCall.findByType('bdi').children.filter(c=>typeof c==='string').join(''),call.phone);
  assert.ok(lastCall.findAllByType('a').some(node=>node.props.href?.startsWith('https://wa.me/')));
  await act(async()=>lastCall.findByType('button').props.onClick());
  assert.equal(renderer.root.findAllByProps({'aria-label':'تعديل الطلب'}).length,1);
  let request;await act(async()=>{request=table().props.onSend('r','busy');await table().props.onSend('r','busy');});
  assert.equal(sent.length,1);assert.equal(sent[0].type,'send');
  data.reception={...reception,rides:[{...ride,rideVersion:4,queuedDriverId:'busy',jobPosition:1}]};
  await act(async()=>{release();await request;});
  assert.equal(table().props.rides[0].jobPosition,1);
  await act(async()=>live({...reception,rides:[{...ride,rideVersion:5,queuedDriverId:'busy',jobPosition:2}]}));
  assert.equal(table().props.rides[0].jobPosition,2);
  globalThis.sendQueueApi.changeJob=async()=>{throw new Error('conflict');};const before=reads;
  await act(async()=>{await assert.rejects(table().props.onSend('r','busy'),/conflict/);});assert.ok(reads>before);
  assert.equal(renderer.root.findAllByType('traditional-queue').length,0);
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='قائمة الدور').props.onClick());
  assert.equal(renderer.root.findByType('traditional-queue').props.queueId,'driver-queue-floating');
  assert.equal(renderer.root.findAllByProps({'aria-label':'السائقون المتصلون'}).length,0);assert.ok(renderer.root.findByProps({'aria-label':'المتصلون والدور'}));
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.sendQueueApi;}
});
