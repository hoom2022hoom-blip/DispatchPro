import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('unpriced completion requires collection and sends amount plus completion once',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/driver-api')return{url:'data:text/javascript,export const createDriverApi=()=>globalThis.driverScreenApi;export class DriverApiError extends Error{};export const noticeLabel=()=>"notice";',shortCircuit:true};return next(s,c);}});
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 let renderer;let ride={id:'unpriced',status:'InProgress',version:7,pickup:'Pickup',destination:'Destination',finalFare:null,fareMode:'OFFICE_MANUAL'};const writes=[];
 const profile={id:'driver',fullName:'Driver',status:'Busy',allowDriverManualFare:false};const wait=()=>new Promise(r=>setTimeout(r,20));
 globalThis.driverScreenApi={login:async()=>profile,logout(){},offerNow:()=>Date.now(),ride:async()=>ride,updates:async(cursor,signal)=>cursor?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})):{cursor:String(ride.version),data:{driver:profile,rides:ride.status==='Completed'?[]:[ride],notices:[],jobs:[]}},transition:async(value,status,amount)=>{writes.push({id:value.id,version:value.version,status,amount});await wait();ride={...ride,status:'Completed',version:8,finalFare:amount};}};
 const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
 try{
  const {DriverApiDashboard}=await import('../src/components/driver-api-dashboard.tsx');await act(async()=>{renderer=TestRenderer.create(React.createElement(DriverApiDashboard));});await act(async()=>{await renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await wait();});await act(wait);
  await act(async()=>button('إنهاء الرحلة').props.onClick());assert.equal(writes.length,0);assert.match(JSON.stringify(renderer.toJSON()),/أدخل المبلغ الذي تم تحصيله/);
  const form=renderer.root.findByType('form');await act(async()=>form.props.onSubmit({preventDefault(){}}));assert.equal(writes.length,0);
  await act(async()=>renderer.root.findByProps({type:'number'}).props.onChange({target:{value:'18'}}));
  const confirm=renderer.root.findByType('form').props.onSubmit;await act(async()=>{confirm({preventDefault(){}});confirm({preventDefault(){}});await wait();});await act(wait);
  assert.deepEqual(writes,[{id:'unpriced',version:7,status:'Completed',amount:18}]);assert.equal(button('تأكيد وإنهاء الرحلة'),undefined);
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.driverScreenApi;delete globalThis.window;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});

test('Driver screen hides customer before acceptance, progresses ride, shows history and disables offline actions',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/driver-api')return{url:'data:text/javascript,export const createDriverApi=()=>globalThis.driverScreenApi;export class DriverApiError extends Error{};export const noticeLabel=()=>"notice";',shortCircuit:true};return next(s,c);}});
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 let renderer;let ride={fareMode:'GPS_METER',fareSource:'OFFICE_OVERRIDE',finalFare:20,currency:'ILS',id:'ride-1',version:1,status:'Assigned',pickup:'Pickup',destination:'Destination',phone:'0591234567',fullName:'PRIVATE_NAME',notes:'PRIVATE_NOTE',latitude:32.22,longitude:35.25,destinationLatitude:32.23,destinationLongitude:35.27,offerExpiresAt:'2020-01-01T12:00:30Z'};
 let status='Available';const mutations=[];let logout=false;
 const profile=()=>({id:'driver',fullName:'Driver',status});
 const wait=()=>new Promise(resolve=>setTimeout(resolve,15));
 globalThis.driverScreenApi={
  offerNow:()=>Date.parse('2020-01-01T12:00:00Z'),login:async()=>profile(),logout(){logout=true;},
  updates:async(cursor,signal)=>{if(cursor)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));return{cursor:'snapshot-'+ride.version,data:{driver:profile(),rides:ride.status==='Completed'?[]:[{...ride}],notices:[],jobs:[{id:'job',rideId:'queued-ride',driverId:'driver',position:1,pickup:'QUEUED_PICKUP',destination:'QUEUED_DESTINATION'}]}};},
  ride:async()=>({...ride}),
  transition:async(value,next)=>{mutations.push({version:value.version,next});ride={...ride,status:next,version:ride.version+1,...(next==='InProgress'?{meterStartedAt:'2020-01-01T11:50:00Z',durationSeconds:600,distanceKm:2.5,meterCalculatedFare:23}: {})};},
  availability:async next=>{status=next;},
  history:async()=>({page:1,total:1,items:[{...ride,createdAt:'2026-09-29T10:00:00Z'}]}),
 };
 const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
 const content=()=>JSON.stringify(renderer.toJSON());
 try{
  const {DriverApiDashboard}=await import('../src/components/driver-api-dashboard.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(DriverApiDashboard));});
  await act(async()=>{await renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await wait();});await act(wait);
  assert.match(renderer.root.findByType('main').props.className,/taxi-surface driver-theme/);
  assert.match(content(),/تكسي نابلس/);
  assert.match(content(),/Pickup/);assert.match(content(),/Destination/);assert.ok(button('قبول'));assert.ok(button('رفض'));assert.doesNotMatch(content(),/0591234567/);assert.match(content(),/PRIVATE_NAME/);assert.match(content(),/PRIVATE_NOTE/);
  assert.equal(button('قبول').props.disabled,false);assert.equal(button('رفض').props.disabled,false);
  assert.equal(button('إنهاء الرحلة'),undefined);assert.match(content(),/20 ₪/);
  assert.match(content(),/QUEUED_PICKUP/);
  const queue=renderer.root.findByProps({'aria-label':'الرحلات المنتظرة'});
  assert.equal(queue.findAllByType('button').length,0,'Queued work cannot be accepted or started before promotion');
  assert.match(JSON.stringify(renderer.root.findByProps({role:'timer'}).children),/30/);
  await act(async()=>{navigator.onLine=false;window.dispatchEvent(new Event('offline'));});assert.equal(button('قبول').props.disabled,true);
  await act(async()=>{navigator.onLine=true;window.dispatchEvent(new Event('online'));await wait();});await act(wait);
  for(const [label,next] of [['قبول','Accepted'],['في الطريق إلى الزبون','DriverArriving'],['وصلت للزبون','Arrived'],['بدء الرحلة','InProgress'],['إنهاء الرحلة','Completed']]){
   assert.equal(button(label).props.disabled,false);
   await act(async()=>{button(label).props.onClick();await wait();});await act(wait);
   assert.equal(mutations.at(-1).next,next);if(next==='InProgress'){assert.match(content(),/العداد يعمل/);assert.match(content(),/2.5/);assert.match(content(),/23/);}
   const radio=renderer.root.findByProps({'aria-label':'المخشيرة'});assert.match(radio.props.className,/fixed.*bottom-0/);assert.equal(radio.findAllByType('button').length,2,'Both PTT channels remain visible throughout the ride');
   if(next!=='Completed'){assert.match(content(),/0591234567/);assert.match(content(),/PRIVATE_NAME/);assert.match(content(),/PRIVATE_NOTE/);assert.ok(renderer.root.findAllByType('button').some(b=>b.children.includes('اتصال بالزبون')));assert.equal(renderer.root.findAllByType('a').some(a=>a.props.href.startsWith('tel:')),false);}
   if(['Accepted','DriverArriving','Arrived','InProgress'].includes(next)){
    const navigation=renderer.root.findAllByType('a').find(a=>a.props.href.includes('/maps/dir/'));
    assert.ok(navigation);assert.match(navigation.props.href,next==='InProgress'?/destination=32.23,35.27/:/destination=32.22,35.25/);
    assert.equal(!!button('إنهاء الرحلة'),next==='InProgress');
   }
  }
  assert.deepEqual(mutations.map(m=>m.version),[1,2,3,4,5]);
  await act(async()=>renderer.root.findByProps({'aria-label':'إعدادات السائق'}).props.onClick());await act(async()=>{button('سجل الرحلات').props.onClick();await wait();});assert.match(content(),/مكتملة/);
  await act(async()=>renderer.root.findByProps({'aria-label':'إعدادات السائق'}).props.onClick());await act(async()=>button('تسجيل الخروج').props.onClick());assert.equal(logout,true);assert.match(content(),/تسجيل دخول السائق/);assert.doesNotMatch(content(),/PRIVATE_/);
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.driverScreenApi;delete globalThis.window;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
