import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {receptionError} from '../src/lib/reception-feedback.ts';

test('app filter preserves office orders; cancellation locks only its row and does not repeat',async()=>{
 const hooks=receptionRenderHooks();let renderer,release,confirmations=0;
 const previousWindow=globalThis.window;globalThis.window={confirm:()=>{confirmations++;return true;}};
 const saved=[];
 try{
  const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
  const base={createdAt:new Date(),status:'pending',pickup:{name:'عنوان طويل'},passengerName:'زبون',passengerPhone:'0599000000'};
  const rides=[{...base,id:'app',source:'CUSTOMER_APP'},{...base,id:'office',source:'MANUAL'},{...base,id:'closed',status:'completed'}];
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeReceptionTable,{rides,drivers:[],choices:[],onAssign:async()=>{},onEdit:()=>{},onDuplicate:async()=>{},onSave:async ride=>{saved.push(ride);await new Promise(resolve=>release=resolve);}}));});
  const buttons=()=>renderer.root.findByProps({'aria-label':'مصدر الطلبات'}).findAllByType('button');
  const rows=()=>renderer.root.findByType('tbody').findAllByType('tr');
  assert.equal(rows().length,2);assert.equal(buttons()[0].props['aria-pressed'],true);
  await act(async()=>buttons()[2].props.onClick());assert.equal(rows().length,1);assert.equal(buttons()[2].props['aria-pressed'],true);
  await act(async()=>buttons()[1].props.onClick());assert.equal(rows().length,3);
  const cancel=row=>row.findAllByType('button').find(b=>b.children.join('')==='إلغاء الطلب');
  assert.equal(cancel(rows().find(row=>row.props['data-state']==='COMPLETED')),undefined);
  const click=cancel(rows()[0]).props.onClick;
  await act(async()=>{click();click();});
  assert.equal(confirmations,1);assert.equal(saved.length,1);assert.equal(saved[0].status,'cancelled');assert.equal(saved[0].driverId,null);
  assert.equal(cancel(rows()[0]).props.disabled,true);assert.equal(cancel(rows().filter(row=>row.props['data-state']==='PENDING')[1]).props.disabled,false);
  await act(async()=>{release();});assert.equal(cancel(rows()[0]).props.disabled,false);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();globalThis.window=previousWindow;}
});

test('expected technical errors become Arabic feedback and keep diagnostic evidence',()=>{
 const original=console.error,logs=[];console.error=(...args)=>logs.push(args);
 try{
  for(const message of ['API 404','Conflict 409','stale state','version mismatch','Failed to fetch','SQL exception']){
   const failure=new Error(message),shown=receptionError(failure);
   assert.match(shown,/[\u0600-\u06ff]/);assert.ok(!shown.includes(message));assert.equal(logs.at(-1)[1],failure);
  }
 }finally{console.error=original;}
});
