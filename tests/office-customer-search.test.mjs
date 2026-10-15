import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('customer manager searches beyond its first page and loads selected addresses',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){
  let source;if(s==='@/lib/reception-api')source='export const apiReceptionBackend=globalThis.customerSearchApi;';
  if(s==='next/navigation')source='export const useRouter=()=>({push(){}});';
  if(s==='./customer-places-map')source='export const CustomerPlacesMap=()=>null;';
  return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);
 }});
 const extra={id:'outside-first-page',fullName:'زبون بعيد',phone:'+970591234567',secondaryPhone:'0561234567',addressText:'رفيديا',orderCount:2,firstOrderAt:'2026-10-01T10:00:00Z',lastOrderAt:'2026-10-02T10:00:00Z'},calls=[];let renderer;
 globalThis.customerSearchApi={customerPage:async(q,page)=>{calls.push(['customers',q,page]);return {items:q?[extra]:[],total:q?1:0,totalCustomers:42,page,pageSize:50};},saveCustomer:async value=>{calls.push(['save',value]);return value;},places:async(q,id)=>{calls.push(['places',id]);return[];}};
 try{
  const {OfficeCustomers}=await import('../src/components/office-customers.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeCustomers));});
  await act(async()=>{renderer.root.findByProps({'aria-label':'بحث العملاء'}).props.onChange({target:{value:'00972 59 123 4567'}});});
  await act(async()=>{await new Promise(r=>setTimeout(r,320));});
  assert.ok(calls.some(([kind,q])=>kind==='customers'&&q==='00972 59 123 4567'));
  assert.match(JSON.stringify(renderer.toJSON()),/إجمالي الزبائن/);assert.match(JSON.stringify(renderer.toJSON()),/42/);assert.match(JSON.stringify(renderer.toJSON()),/رفيديا/);assert.equal(renderer.root.findAllByType('th').length,7);
  const profile=renderer.root.findByProps({'aria-label':'تعديل زبون بعيد'});
  assert.ok(profile,JSON.stringify(renderer.toJSON()));await act(async()=>profile.props.onClick());
  assert.ok(calls.some(([kind,id])=>kind==='places'&&id===extra.id));
  assert.equal(renderer.root.findByProps({'aria-label':'عنوان الزبون'}).props.required,undefined);
  await act(async()=>renderer.root.findByProps({'aria-label':'عنوان الزبون'}).props.onChange({target:{value:'شارع القدس'}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls.find(([kind])=>kind==='save')[1].addressText,'شارع القدس');
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.customerSearchApi;}
});
