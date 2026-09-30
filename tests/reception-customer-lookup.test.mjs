import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {setTimeout as delay} from 'node:timers/promises';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const hooks=receptionRenderHooks();
const {CallLoggerForm}=await import('../src/components/call-logger-form.tsx');
test('reception resolves a customer outside the initial list and submits the selected linked address',async()=>{
 const customer={id:'customer-imported',fullName:'عميل مستورد',phone:'+970591234567'};
 const places=['first','second'].map(id=>({customerName:customer.fullName,phone:customer.phone,address:{id,customerId:customer.id,label:id,addressText:'عنوان '+id,isDefault:false}}));
 const calls=[],saved=[];let renderer;
 const lookupCustomer=async p=>{calls.push(p);return {customer,places};};
 try {
  await act(async()=>{renderer=TestRenderer.create(React.createElement(CallLoggerForm,{lookupCustomer,onAddRide:r=>saved.push(r),onEditRide:async()=>{}}));});
  await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.name==='passengerPhone').props.onChange({target:{name:'passengerPhone',value:'0591234567'}}));
  await act(async()=>delay(300));
  assert.deepEqual(calls,['0591234567']);assert.equal(renderer.root.find(n=>n.type==='input'&&n.props.name==='passengerName').props.value,customer.fullName);
  assert.equal(renderer.root.findByProps({'aria-label':'عنوان العميل المحفوظ'}).findAllByType('option').length,3);
  await act(async()=>renderer.root.findByProps({'aria-label':'عنوان العميل المحفوظ'}).props.onChange({target:{value:'second'}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){},persist(){}}));
  assert.equal(saved.length,1);assert.equal(saved[0].customerId,customer.id);assert.equal(saved[0].savedAddressId,'second');assert.equal(saved[0].pickup.name,'عنوان second');
 }finally{await act(async()=>renderer?.unmount());}
});
test('a stale phone lookup cannot select the previous customer',async()=>{
 let release,renderer;const old=new Promise(r=>release=r);
 const lookupCustomer=async p=>p==='0591234567'?old:{customer:{id:'new',fullName:'العميل الجديد',phone:p},places:[]};
 try{
  await act(async()=>{renderer=TestRenderer.create(React.createElement(CallLoggerForm,{lookupCustomer,onAddRide:async()=>{},onEditRide:async()=>{}}));});
  const type=async value=>act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.name==='passengerPhone').props.onChange({target:{name:'passengerPhone',value}}));
  await type('0591234567');await act(async()=>delay(300));await type('0597654321');await act(async()=>delay(300));
  await act(async()=>release({customer:{id:'old',fullName:'قديم'},places:[]}));
  assert.equal(renderer.root.find(n=>n.type==='input'&&n.props.name==='passengerName').props.value,'العميل الجديد');
 }finally{await act(async()=>renderer?.unmount());}
});
