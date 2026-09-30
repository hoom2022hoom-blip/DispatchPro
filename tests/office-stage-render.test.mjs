import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('Office settings enforce access in UI; user edits preserve account and role selection',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.stageApi;',shortCircuit:true};if(s==='next/link')return{url:'data:text/javascript,export default "a";',shortCircuit:true};return next(s,c);}});
 const calls=[];let renderer;const wait=()=>new Promise(r=>setTimeout(r,25));
 globalThis.stageApi={administration:async(path,method,body)=>{calls.push({path,method,body});if(path==='administration/access')return{actorId:'a',tenantId:'t',permissions:['users.write']};if(path==='administration/roles')return{roles:[{id:'r',name:'Dispatcher',codes:['rides.read']}],codes:['rides.read','users.write']};if(path.startsWith('administration/users?'))return{total:1,items:[{id:'u',username:'operator',roleId:'r',active:true}]};return{};}};
 try{
  const {OfficeAdministration}=await import('../src/components/office-administration.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeAdministration));await wait();});
  assert.ok(!calls.some(c=>c.path==='offices'));assert.match(JSON.stringify(renderer.toJSON()),/ليس لديك صلاحية/);
  const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
  await act(async()=>{button('المستخدمون').props.onClick();await wait();});await act(wait);
  await act(async()=>button('تعديل').props.onClick());
  assert.equal(renderer.root.findByType('select').props.value,'r');assert.equal(renderer.root.findAllByType('input').find(i=>i.props.disabled).props.value,'operator');
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));await act(wait);
  assert.deepEqual(calls.find(c=>c.method==='PUT'),{path:'administration/users/u',method:'PUT',body:{roleId:'r',active:true}});
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.stageApi;}
});
test('Order report uses server totals, resets pagination on filters and rejects reversed date range',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.orderStageApi;',shortCircuit:true};return next(s,c);}});
 const calls=[];let renderer;const wait=()=>new Promise(r=>setTimeout(r,220));
 globalThis.orderStageApi={reportHistory:async q=>{calls.push(q);return{total:51,page:q.page,pageSize:50,items:[{id:'o',orderNumber:1,passengerName:'Customer',notes:'saved detail'}]};}};
 try{const {OfficeOrderReport}=await import('../src/components/office-order-report.tsx');await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeOrderReport,{today:'2026-01-02',drivers:[]}));await wait();});await act(wait);
  assert.match(JSON.stringify(renderer.toJSON()),/51/);assert.match(JSON.stringify(renderer.toJSON()),/saved detail/);
  await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='التالي').props.onClick();await wait();});await act(wait);assert.equal(calls.at(-1).page,2);
  await act(async()=>{renderer.root.findAllByType('input').find(i=>i.props.placeholder).props.onChange({target:{value:'059'}});await wait();});await act(wait);assert.equal(calls.at(-1).page,1);assert.equal(calls.at(-1).search,'059');
  const count=calls.length;await act(async()=>{renderer.root.findAllByType('input').find(i=>i.props.type==='date').props.onChange({target:{value:'2026-02-02'}});await wait();});assert.equal(calls.length,count);assert.match(JSON.stringify(renderer.toJSON()),/تاريخ البداية/);
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.orderStageApi;}
});
