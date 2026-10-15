import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('compact toolbar preserves queue, customer lookup, latest-call order and WhatsApp',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){
  const sources={
   '@/lib/reception-api':'export const apiReceptionBackend=globalThis.topBarApi;export const decodeReceptionSnapshot=x=>x;',
   '@/lib/reception-backend':'export const getReceptionBackend=()=>globalThis.topBarApi;',
   './floating-queue-window':'export const FloatingQueueWindow="queue-window";',
   './office-queue':'export const OfficeQueuePanel=()=>null;export const reorderOfficeQueue=async()=>{};',
   './reception-edit-form':'export const ReceptionEditForm="edit-order";',
   './office-driver-jobs':'export const OfficeDriverJobs=()=>null;',
  };
  if(s==='next/dynamic')return {url:'data:text/javascript,export default ()=>"customer-lookup";',shortCircuit:true};
  if(sources[s])return {url:'data:text/javascript,'+encodeURIComponent(sources[s]),shortCircuit:true};
  return next(s,c);
 }});
 const call={eventId:'call-test',phone:'0591234567',source:'LANDLINE_ICALL',line:'1',timestamp:new Date().toISOString()};
 const reception={rides:[],drivers:[],vehicles:[],shifts:[],queue:[],latest:call};
 const data={drivers:[],vehicles:[],reception};let latest=call,notify,received=0,view;
 globalThis.topBarApi={getLatestCall:()=>latest,subscribeLatest:f=>{notify=f;return()=>{};},watchLatest:()=>()=>{},subscribe:f=>{f(reception);return()=>{};},office:async()=>data,receiveCall:async c=>{received++;reception.rides.push({id:'order',callEventId:c.eventId,pickup:{name:''},status:'pending'});}};
 try{
  const {ApiReception}=await import('../src/components/api-reception.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(ApiReception,{officeTenant:'test'}));});
  const button=text=>view.root.findAllByType('button').find(b=>b.children.join('')===text);
  const queue=button('قائمة الدور'),lookup=button('كشف زبون');assert.equal(queue.parent,lookup.parent);
  await act(async()=>queue.props.onClick());assert.equal(view.root.findByType('queue-window').props.open,true);
  let navigated;globalThis.topBarNavigation=path=>navigated=path;await act(async()=>lookup.props.onClick());assert.equal(navigated,'/office/customer-history');delete globalThis.topBarNavigation;
  assert.equal(view.root.findByType('office-notifications').props.compact,true);
  const phone=()=>view.root.findByProps({'aria-label':`فتح طلب آخر مكالمة: ${call.phone}`});
  assert.ok(phone().props.title.includes('الخط: 1'));
  const link=view.root.findAllByType('a').find(a=>a.children.includes('واتساب'));assert.ok(link.props.href.startsWith('https://wa.me/970591234567?text='));assert.equal(link.props.target,'_blank');
  await act(async()=>phone().props.onClick());assert.equal(received,1);assert.equal(view.root.findByType('edit-order').props.ride.callEventId,call.eventId);
  await act(async()=>phone().props.onClick());assert.equal(received,1);
  assert.ok(!JSON.stringify(view.toJSON()).includes('اضغط الرقم لفتح الطلب'));
  await act(async()=>{latest={...call,phone:'invalid'};notify();});assert.equal(button('واتساب').props.disabled,true);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.topBarApi;}
});

test('alerts start closed, show the API count and open the existing notification list',async()=>{
 const hooks=receptionRenderHooks();const react=JSON.stringify(import.meta.resolve('react'));
 const stub=registerHooks({resolve(s,c,next){
  const sources={
   '@/lib/reception-api':'export const apiReceptionBackend=globalThis.noticeApi;export class ReceptionApiError extends Error{};',
   './ui/popover':`import React from ${react};const C=React.createContext(null);export function Popover(p){const [open,set]=React.useState(false);return React.createElement(C.Provider,{value:{open,set}},p.children);}export function PopoverTrigger(p){const c=React.useContext(C);return React.cloneElement(p.children,{onClick:()=>c.set(!c.open)});}export function PopoverContent(p){return React.useContext(C).open?React.createElement('section',p):null;}`,
  };if(sources[s])return {url:'data:text/javascript,'+encodeURIComponent(sources[s]),shortCircuit:true};return next(s,c);
 }});
 let view,calls=0;const notices=Array.from({length:50},(_,i)=>({id:String(i),entityId:'ride-'+i,action:'ride.created',createdAt:new Date().toISOString()}));
 globalThis.noticeApi={notificationUpdates:async()=>{if(calls++)return new Promise(()=>{});return {cursor:'50',data:notices};}};
 try{
  const {OfficeLiveNotifications}=await import('../src/components/office-live-notifications.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(OfficeLiveNotifications,{compact:true}));});
  assert.equal(view.root.findAllByType('section').length,0);
  const trigger=view.root.findByProps({'aria-label':'تنبيهات الطلبات والسائقين (50)'});assert.ok(trigger.findAllByType('span').some(s=>s.children.join('')==='50'));
  await act(async()=>trigger.props.onClick());
  const panel=view.root.findByType('section');assert.equal(panel.findAllByType('p').length,50);
  assert.ok(panel.findAllByType('button').some(b=>b.children.includes('تفعيل إشعارات المتصفح')));
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.noticeApi;}
});
