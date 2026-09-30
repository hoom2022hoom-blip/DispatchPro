import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('Driver and customer report picker, date filters, totals, paging and details',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.reportApi;',shortCircuit:true};return next(s,c);}});
 const calls=[];let renderer;const jumps=[];
 globalThis.reportApi={reportDrivers:async q=>{calls.push(['drivers',q]);return[{id:'d',fullName:'سائق التقرير'}];},customers:async q=>{calls.push(['customers',q]);return[{id:'c',fullName:'زبون التقرير',phone:'0591234567'}];},places:async()=>[],reportHistory:async f=>{calls.push(['history',f]);return{total:51,page:f.page,pageSize:50,items:[{id:'r',orderNumber:99,createdAt:'2026-09-28T10:00:00Z',notes:'تفاصيل محفوظة',assignedAt:'2026-09-28T10:01:00Z',passengerPhone:'0591234567',source:'WHATSAPP'}]};}};
 const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,230));});
 try{
  const {OfficeHistoryReport}=await import('../src/components/office-history-report.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeHistoryReport,{data:{drivers:[]}}),{createNodeMock:element=>({scrollIntoView:()=>jumps.push(element.props['aria-label'])})});});
  const input=()=>renderer.root.findByProps({'aria-label':'بحث التقرير'});
  for(const kind of ['driver','customer']){
   if(kind==='customer')await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='تقرير الزبون').props.onClick());
   await act(async()=>input().props.onFocus());await settle();assert.ok(calls.some(c=>c[0]===(kind==='driver'?'drivers':'customers')&&c[1]===''));
   for(const term of kind==='driver'?['تقر','0591']:['0591','زبون']){await act(async()=>input().props.onChange({target:{value:term}}));assert.equal(renderer.root.findByProps({role:'listbox'}).props['aria-busy'],true);await settle();assert.equal(calls.at(-1)[1],term);}
   await act(async()=>renderer.root.findByProps({'aria-label':'مسح بحث التقرير'}).props.onClick());assert.equal(input().props.value,'');assert.equal(renderer.root.findAllByProps({role:'listbox'}).length,0);
   await act(async()=>input().props.onClick());await settle();assert.equal(calls.at(-1)[1],'');
   await act(async()=>renderer.root.findByProps({role:'option'}).props.onClick());
   await act(async()=>renderer.root.findByProps({'aria-label':'من تاريخ التقرير'}).props.onChange({target:{value:'2026-09-01'}}));
   await act(async()=>renderer.root.findByProps({'aria-label':'إلى تاريخ التقرير'}).props.onChange({target:{value:'2026-09-28'}}));
   const filter=calls.filter(c=>c[0]==='history').at(-1)[1];assert.equal(filter[kind==='driver'?'driverId':'customerId'],kind==='driver'?'d':'c');assert.equal(filter.from,'2026-09-01');assert.equal(filter.to,'2026-09-28');
   assert.ok(renderer.root.findByProps({'aria-label':'إجمالي التقرير'}).children.includes('51'));
   assert.equal(renderer.root.findByType('summary').children.join(''),'فتح التفاصيل');assert.match(JSON.stringify(renderer.toJSON()),/تفاصيل محفوظة/);
   await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='التالي').props.onClick());assert.equal(calls.at(-1)[1].page,2);
   await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='بحث').props.onClick());assert.equal(calls.at(-1)[1].page,1);
   await act(async()=>renderer.root.findByProps({'aria-label':'ترتيب نتائج التقرير'}).props.onChange({target:{value:'oldest'}}));assert.equal(calls.at(-1)[1].sort,'oldest');
   await act(async()=>renderer.root.findByProps({'aria-label':'النزول إلى نتائج التقرير'}).props.onClick());await act(async()=>renderer.root.findByProps({'aria-label':'العودة لأعلى التقرير'}).props.onClick());assert.deepEqual(jumps.slice(-2),['نتائج التقرير','تقرير السائق والزبون']);
  }
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.reportApi;}
});
