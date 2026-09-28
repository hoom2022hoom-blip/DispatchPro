import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {dispatchStates,changeDispatch,dispatchState,receptionColumns,duplicateReceptionRide} from '../src/lib/office-dispatch.ts';
import {businessDay} from '../src/lib/ride-numbering.ts';

test('dispatch mock has eight text/color states and requires a driver before sending',()=>{
 assert.equal(Object.keys(dispatchStates).length,8);
 for(const state of Object.values(dispatchStates)){assert.ok(state.label);assert.match(state.color,/bg-/);assert.match(state.color,/text-/);}
 const ride={status:'pending',driverId:null};assert.throws(()=>changeDispatch(ride,'SENT'),/السائق/);
 const selected={...ride,driverId:'driver'};assert.equal(dispatchState(selected),'PENDING');
 assert.equal(changeDispatch(selected,'SENT').status,'assigned');assert.equal(changeDispatch(selected,'SENT').shiftId,null);
 assert.equal(changeDispatch(selected,'REJECTED').status,'waiting');assert.equal(changeDispatch(selected,'CANCELLED').driverId,null);
});

test('mounted unified queue searches drivers, adds once, selects and reorders from fixed controls',async()=>{
 const mutations=[];const enteredAt='2026-09-28T10:00:00Z';const data={drivers:[{id:'a',fullName:'أحمد',phoneLocal:'0591111111',active:true,status:'Available',currentVehicleId:'v1'},{id:'b',fullName:'محمد',phoneLocal:'0592222222',active:true,status:'Available',currentVehicleId:'v2'},{id:'c',fullName:'رائد',phoneLocal:'0593333333',active:true,status:'Available',currentVehicleId:'v3'}],vehicles:[{id:'v1',plate:'AA-1'},{id:'v2',plate:'AA-2'},{id:'v3',plate:'AA-3'}],reception:{rides:[],shifts:[],queue:[],queueLocations:[{id:'one',name:'المهندس',isActive:true},{id:'two',name:'نابلس',isActive:true}]}};
 globalThis.__unifiedUi={api:{driverQueue:async v=>{mutations.push(v);const rows=data.reception.queue;const index=rows.findIndex(q=>q.driverId===v.driverId);if(v.type==='add'&&index<0)rows.push({driverId:v.driverId,position:rows.length+1,queueLocationId:v.queueLocationId,joinedAt:enteredAt,enteredAt});else if(v.type==='up'||v.type==='down'){const next=index+(v.type==='up'?-1:1);if(index>=0&&next>=0&&next<rows.length)[rows[index],rows[next]]=[rows[next],rows[index]];rows.forEach((row,i)=>row.position=i+1);}else if(v.type==='remove'&&index>=0){rows.splice(index,1);rows.forEach((row,i)=>row.position=i+1);}else if(v.type==='transfer'&&index>=0)rows[index].queueLocationId=v.queueLocationId;}}};
 const hooks=componentHooks();let renderer;
 try{
  const {OfficeQueuePanel}=await import('../src/components/office-queue.tsx');const render=()=>React.createElement(OfficeQueuePanel,{data,refresh:async()=>{},embedded:true});
  await act(async()=>{renderer=TestRenderer.create(render());});
  const labelled=label=>renderer.root.find(n=>n.props['aria-label']===label);const search=labelled('بحث السائقين للدور');
  await act(async()=>search.props.onFocus());assert.equal(labelled('السائقون المتاحون').findAllByProps({role:'option'}).length,3);
  await act(async()=>search.props.onChange({target:{value:'أحمد'}}));assert.equal(labelled('السائقون المتاحون').findAllByProps({role:'option'}).length,1);
  await act(async()=>labelled('بحث السائقين للدور').props.onChange({target:{value:'059222'}}));assert.equal(labelled('السائقون المتاحون').findAllByProps({role:'option'})[0].props.children[0],'محمد');
  await act(async()=>labelled('بحث السائقين للدور').props.onChange({target:{value:'AA-3'}}));assert.equal(labelled('السائقون المتاحون').findAllByProps({role:'option'})[0].props.children[0],'رائد');
  const add=async(name,query,place)=>{const input=labelled('بحث السائقين للدور');await act(async()=>input.props.onChange({target:{value:query}}));const option=labelled('السائقون المتاحون').findAllByProps({role:'option'}).find(item=>String(item.props.children).startsWith(name));assert.ok(option);await act(async()=>option.props.onClick());await act(async()=>labelled('موقع السائق').props.onChange({target:{value:place}}));await act(async()=>renderer.root.findAllByType('button').find(button=>button.children.join('')==='إضافة للدور').props.onClick());};
  await add('أحمد','أحمد','one');assert.deepEqual(mutations[0],{type:'add',driverId:'a',queueLocationId:'one'});assert.equal(labelled('بحث السائقين للدور').props.value,'');assert.equal(renderer.root.findAllByProps({role:'listbox'}).length,0);
  await act(async()=>labelled('بحث السائقين للدور').props.onFocus());assert.equal(labelled('السائقون المتاحون').findAllByProps({role:'option'}).length,2);
  await add('محمد','059222','two');await add('رائد','AA-3','one');assert.deepEqual(data.reception.queue.map(q=>q.position),[1,2,3]);assert.equal(data.reception.queue[0].enteredAt,enteredAt);
  const rows=renderer.root.findAll(node=>node.props['aria-label']==='اختيار محمد');await act(async()=>rows[0].props.onClick());
  const toolbar=labelled('التحكم بالدور');assert.deepEqual(toolbar.findAllByType('button').map(button=>button.children.join('')),['↑ رفع','↓ تنزيل','إزالة']);
  await act(async()=>toolbar.findAllByType('button')[0].props.onClick());assert.deepEqual(data.reception.queue.map(q=>q.position),[1,2,3]);assert.equal(data.reception.queue[0].driverId,'b');assert.equal(data.reception.queue[0].enteredAt,enteredAt);
  await act(async()=>toolbar.findAllByType('button')[1].props.onClick());assert.equal(data.reception.queue[1].driverId,'b');assert.equal(data.reception.queue[1].enteredAt,enteredAt);
  await act(async()=>labelled('تغيير موقع السائق المحدد').props.onChange({target:{value:'one'}}));assert.equal(data.reception.queue[1].queueLocationId,'one');assert.equal(data.reception.queue[1].enteredAt,enteredAt);
  await act(async()=>toolbar.findAllByType('button')[2].props.onClick());assert.deepEqual(data.reception.queue.map(q=>q.position),[1,2]);assert.deepEqual(data.reception.queue.map(q=>q.driverId),['a','c']);
  assert.deepEqual(mutations.slice(-4).map(m=>m.type),['up','down','transfer','remove']);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.__unifiedUi;}
});

test('mounted reception has exact columns, send and no cancellation control or menu option',async()=>{
 globalThis.__unifiedUi={};const hooks=componentHooks();let renderer;const saves=[],assignments=[];
 let ride={id:'request',orderNumber:1,createdAt:new Date(),status:'pending',dispatchStatus:'PENDING',passengerPhone:'0591234567',passengerName:'زبون',pickup:{name:'عنوان',coords:{x:0,y:0}},addressText:'عنوان',addressType:'FIXED',driverId:null};
 try{
  const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
  const render=()=>React.createElement(OfficeReceptionTable,{rides:[ride],drivers:[{id:'a',name:'أحمد'}],choices:[{id:'a',driverId:'a',label:'أحمد'}],onEdit(){},onDuplicate:async()=>{},onSave:async r=>{saves.push(r);ride=r;renderer.update(render());},onAssign:async(id,driverId)=>{assignments.push({id,driverId});ride={...ride,driverId};renderer.update(render());}});
  await act(async()=>{renderer=TestRenderer.create(render());});
  const textOf=node=>node.children.map(child=>typeof child==='string'?child:textOf(child)).join('');assert.deepEqual(renderer.root.findAllByType('th').map(textOf),receptionColumns);
  assert.ok(!receptionColumns.includes('إلغاء'));
  const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
  assert.equal(button('إرسال').props.disabled,true);
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.findAllByType('span').some(s=>s.children.includes('عنوان'))).props.onClick());
  await act(async()=>renderer.root.findByType('textarea').props.onChange({target:{value:'عنوان يدوي معدل'}}));
  await act(async()=>renderer.root.find(n=>n.props['aria-label']==='نوع العنوان').props.onChange({target:{value:'VARIABLE'}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saves[0].addressText,'عنوان يدوي معدل');assert.equal(saves[0].addressType,'VARIABLE');assert.equal(saves[0].latitude,null);
  await act(async()=>renderer.root.findByType('mock-picker').props.onChange('a'));
  assert.deepEqual(assignments,[{id:'request',driverId:'a'}]);assert.equal(button('إرسال').props.disabled,false);
  await act(async()=>button('إرسال').props.onClick());assert.equal(saves.at(-1).dispatchStatus,'SENT');assert.equal(renderer.root.findByType('mock-picker').props.disabled,false);assert.equal(renderer.root.findByType('mock-picker').props.changeLabel,'تغيير السائق');
  assert.match(renderer.root.find(n=>n.props['aria-label']==='حالة الطلب 1').props.className,/amber/);
  await act(async()=>renderer.root.find(n=>n.props['aria-label']==='حالة الطلب 1').props.onChange({target:{value:'ACCEPTED'}}));assert.equal(saves.at(-1).dispatchStatus,'ACCEPTED');
  assert.equal(renderer.root.findAllByType('button').some(item=>item.children.join('')==='إلغاء'),false);
  assert.equal(renderer.root.find(n=>n.props['aria-label']==='حالة الطلب 1').findAllByType('option').some(item=>item.props.value==='CANCELLED'),false);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.__unifiedUi;}
});

test('reception columns expose resize handles and a reset control',async()=>{
 globalThis.__unifiedUi={};const hooks=componentHooks();let renderer;
 try{
  const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeReceptionTable,{rides:[],drivers:[],choices:[],onEdit(){},onDuplicate:async()=>{},onSave:async()=>{},onAssign:async()=>{}}));});
  assert.equal(renderer.root.findAllByProps({role:'separator'}).length,receptionColumns.length);
  assert.deepEqual(renderer.root.findAllByProps({role:'separator'}).map(handle=>handle.props['aria-label']),receptionColumns.map(name=>`تغيير عرض عمود ${name}`));
  assert.ok(renderer.root.findByProps({type:'button',children:'إعادة ضبط الأعمدة'}));
  assert.ok(renderer.root.findAllByType('col').every(column=>Number.isFinite(column.props.style.width)));
  const table=renderer.root.findByType('table');assert.equal(table.props.style.fontSize,14);
  await act(async()=>renderer.root.findByProps({'aria-label':'تكبير خط الجدول'}).props.onClick());assert.equal(renderer.root.findByType('table').props.style.fontSize,16);
  await act(async()=>renderer.root.findByProps({'aria-label':'تصغير خط الجدول'}).props.onClick());assert.equal(renderer.root.findByType('table').props.style.fontSize,14);
  await act(async()=>renderer.root.findByProps({'aria-label':'تكبير خط الجدول'}).props.onClick());await act(async()=>renderer.root.findByProps({'aria-label':'تكبير خط الجدول'}).props.onClick());await act(async()=>renderer.root.findByProps({'aria-label':'تكبير خط الجدول'}).props.onClick());assert.equal(renderer.root.findByType('table').props.style.fontSize,20);assert.equal(renderer.root.findByProps({'aria-label':'تكبير خط الجدول'}).props.disabled,true);
  await act(async()=>renderer.root.findByProps({'aria-label':'إعادة ضبط الخط'}).props.onClick());assert.equal(renderer.root.findByType('table').props.style.fontSize,14);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.__unifiedUi;}
});

test('reception duplicate confirms once and creates an independent unassigned trip without execution data',async()=>{
 const priorWindow=globalThis.window;let confirms=0;const duplicates=[];let resolveDuplicate;
 globalThis.window={confirm:()=>{confirms++;return true;}};
 globalThis.__unifiedUi={};const hooks=componentHooks();let renderer;
 const original={id:'original-ride',rideRequestId:'original-request',orderNumber:9,orderDay:businessDay(),receptionVersion:4,customerId:'customer-1',savedAddressId:'address-1',passengerPhone:'0591234567',passengerName:'زبون',addressText:'شارع الاختبار',neighborhood:'وسط البلد',street:'شارع 1',latitude:32.2,longitude:35.2,locationSource:'SAVED_ADDRESS',pickup:{name:'شارع الاختبار',coords:{x:32.2,y:35.2}},dropoff:{name:'المحطة',coords:{x:0,y:0}},scheduledTime:new Date('2030-01-01T10:00:00Z'),notes:'ملاحظة',passengerCount:3,totalFare:12,movingFee:true,source:'MANUAL',status:'in-progress',dispatchStatus:'STARTED',driverId:'old-driver',shiftId:'old-shift',assignedAt:new Date(),pickedUpAt:new Date(),paymentDetails:{cash:12},reassignmentLog:[{driverId:'old-driver'}],createdAt:new Date(),updatedAt:new Date()};
 try{
  const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
  const render=()=>React.createElement(OfficeReceptionTable,{rides:[original],drivers:[],choices:[],onEdit(){},onSave:async()=>{},onAssign:async()=>{},onDuplicate:async copy=>{duplicates.push(copy);await new Promise(resolve=>{resolveDuplicate=resolve;});}});
  await act(async()=>{renderer=TestRenderer.create(render());});
  const button=renderer.root.findAllByType('button').find(item=>item.children.join('')==='تكرار');
  await act(async()=>{button.props.onClick();button.props.onClick();});
  assert.equal(confirms,1);assert.equal(duplicates.length,1);
  const copy=duplicates[0];assert.notEqual(copy.id,original.id);assert.equal(copy.rideRequestId,undefined);assert.equal(copy.driverId,null);assert.equal(copy.shiftId,undefined);assert.equal(copy.status,'pending');assert.equal(copy.dispatchStatus,'PENDING');
  for(const key of ['assignedAt','pickedUpAt','startTime','endTime','paymentDetails','reassignmentLog','receptionVersion','orderNumber','orderDay'])assert.equal(copy[key],undefined);
  for(const key of ['customerId','savedAddressId','passengerPhone','passengerName','addressText','addressType','latitude','longitude','source','notes','dropoff'])assert.deepEqual(copy[key],key==='addressType'?'FIXED':original[key]);
  for(const key of ['orderNumber','orderDay','passengerCount','scheduledTime','rideRequestId','shiftId','assignedAt','pickedUpAt','paymentDetails','reassignmentLog'])assert.equal(key in copy,false);
  assert.equal(copy.totalFare,0);assert.equal(copy.movingFee,false);
  assert.equal(copy.driverId,null);assert.equal(copy.dispatchStatus,'PENDING');
  assert.equal(original.driverId,'old-driver');assert.equal(original.status,'in-progress');
  await act(async()=>resolveDuplicate());
  const secondButton=renderer.root.findAllByType('button').find(item=>item.children.join('')==='تكرار');
  await act(async()=>secondButton.props.onClick());
  assert.equal(confirms,2);assert.equal(duplicates.length,2);assert.notEqual(duplicates[0].id,duplicates[1].id);assert.equal(original.id,'original-ride');
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.__unifiedUi;if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;}
});

function componentHooks(){
 const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 return registerHooks({resolve(specifier,context,next){
  if(/\/(office-queue|office-reception-table)\.tsx$/.test(context.parentURL??'')){
   if(specifier==='./office-workspace')return stub('export const useOffice=()=>({});');
   if(specifier==='@/lib/reception-api')return stub('export const apiReceptionBackend={driverQueue:(...args)=>globalThis.__unifiedUi.api.driverQueue(...args)};');
   if(specifier==='@hello-pangea/dnd')return stub('export const DragDropContext="div";export const Draggable=({children})=>children({innerRef:()=>{},draggableProps:{},dragHandleProps:{}});');
   if(specifier==='./strict-mode-droppable')return stub('export const StrictModeDroppable=({children})=>children({innerRef:()=>{},droppableProps:{},placeholder:null});');
   if(specifier==='./shift-picker')return stub('export const ShiftPicker="mock-picker";');
   if(specifier==='./ui/button')return stub('export const Button="button";');
   if(specifier==='./ui/input')return stub('export const Input="input";');
   if(specifier.startsWith('@/'))return next(new URL('../src/'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  }return next(specifier,context);
 },load(url,context,next){if(/\/(office-queue|office-reception-table)\.tsx$/.test(url))return{format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,context);}});
}



