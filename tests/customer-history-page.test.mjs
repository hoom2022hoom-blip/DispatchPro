import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import {registerHooks} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('customer file searches with debounce, loads only after selection, and pages tabs server-side',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.historyTestApi;',shortCircuit:true};return next(s,c);}});
 let view;const requests=[];const customer={id:'customer',fullName:'زبون الاختبار',phone:'0591234567',addressText:'عنوان',orderCount:42};
 globalThis.historyTestApi={customerPage:async(...args)=>{requests.push(['search',...args]);return{items:[customer],total:1};},customerHistory:async(id,kind,page)=>{requests.push(['history',id,kind,page]);return{customer:{...customer,addresses:[]},summary:{totalOrders:42,completedOrders:19,firstOrderAt:'2026-09-01T10:00:00Z',lastOrderAt:'2026-10-01T10:00:00Z'},total:42,page,pageSize:25,items:kind==='orders'?[{id:'old-order',createdAt:'2026-09-01T10:00:00Z',passengerName:customer.fullName,pickup:'عنوان حقيقي',destination:'وجهة حقيقية',finalFare:15,status:'Completed',auditEvents:[{createdAt:'2026-09-01T10:05:00Z',action:'ride.notification.Accepted',detail:''}]}]:[]};}};
 try{const{OfficeCustomerHistory}=await import('../src/components/office-customer-history.tsx');await act(async()=>{view=TestRenderer.create(React.createElement(OfficeCustomerHistory));});assert.deepEqual(requests,[]);
 const input=view.root.findByProps({id:'customer-history-search'});await act(async()=>{input.props.onChange({target:{value:'05'}});input.props.onChange({target:{value:'0591234567'}});});await act(async()=>delay(350));assert.deepEqual(requests,[['search','0591234567',1,20]]);
 await act(async()=>view.root.findByProps({'aria-label':'نتائج بحث الزبائن'}).findAllByType('button')[0].props.onClick());assert.deepEqual(requests.at(-1),['history','customer','orders',1]);assert.ok(JSON.stringify(view.toJSON()).includes('42'));
 const button=text=>view.root.findAllByType('button').find(b=>b.children.join('')===text);
 await act(async()=>button('تفاصيل').props.onClick());assert.ok(JSON.stringify(view.toJSON()).includes('قبول السائق'));assert.equal(requests.filter(r=>r[0]==='history').length,1);
 await act(async()=>button('التالي').props.onClick());assert.deepEqual(requests.at(-1),['history','customer','orders',2]);
 await act(async()=>button('الاتصالات').props.onClick());assert.deepEqual(requests.at(-1),['history','customer','calls',1]);
 await act(async()=>button('جميع الحركات').props.onClick());assert.deepEqual(requests.at(-1),['history','customer','activity',1]);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.historyTestApi;}
});
