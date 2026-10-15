import {businessDay} from '../src/lib/ride-numbering.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import ts from 'typescript';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';
test('persisted order numbers with ascending time, new-row scroll, persisted widths and compact font controls',async()=>{
 const hooks=componentHooks();let renderer;const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 const scroller={scrollTop:0,scrollHeight:900};const base={passengerName:'عميل',passengerPhone:'092345678',pickup:{name:'عنوان'},status:'pending',receptionPending:true,orderDay:businessDay()};
 let rides=[{...base,id:'newer',createdAt:'2026-09-28T15:40:00Z',orderNumber:1},{...base,id:'older',createdAt:'2026-09-28T01:28:00Z',orderNumber:99}];
 try{const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');const render=()=>React.createElement(OfficeReceptionTable,{rides,drivers:[],choices:[],onAssign:async()=>{},onSave:async()=>{},onEdit:()=>{},onDuplicate:async()=>{}});const options={createNodeMock:element=>element.props['aria-label']==='تمرير الطلبات'?scroller:null};
 await act(async()=>{renderer=TestRenderer.create(render(),options);});
 const rows=()=>renderer.root.findByType('tbody').findAllByType('tr');assert.equal(rows()[0].findAllByType('td')[1].children.join(''),'04:28');assert.equal(rows()[1].findAllByType('td')[0].children.join(''),'1');assert.equal(renderer.root.findAllByType('th')[0].children[0].children[0],'عدد');assert.equal(renderer.root.findAllByType('col')[0].props.style.width,`${42/1006*100}%`);assert.equal(renderer.root.findAllByType('th').length,10);
 rides=[...rides,{...base,id:'last',createdAt:'2026-09-28T20:05:00Z',orderNumber:2}];await act(async()=>renderer.update(render()));assert.equal(scroller.scrollTop,0);assert.equal(rows()[2].findAllByType('td')[0].children.join(''),'2');assert.equal(rows()[2].findAllByType('td')[1].children.join(''),'23:05');
 const button=label=>renderer.root.findAllByType('button').find(b=>b.children.join('')===label);await act(async()=>button('A+').props.onClick());assert.equal(renderer.root.findByType('table').props.style.fontSize,18);
 const handle=renderer.root.findAllByProps({role:'separator'})[1];await act(async()=>handle.props.onPointerDown({currentTarget:{setPointerCapture(){}},pointerId:1,clientX:200}));await act(async()=>handle.props.onPointerUp({pointerId:1,clientX:180}));assert.equal(renderer.root.findAllByType('col')[1].props.style.width,`${88/1026*100}%`);
 await act(async()=>renderer.unmount());await act(async()=>{renderer=TestRenderer.create(render(),options);});assert.equal(renderer.root.findByType('table').props.style.fontSize,18);assert.equal(renderer.root.findAllByType('col')[1].props.style.width,`${88/1026*100}%`);await act(async()=>button('افتراضي').props.onClick());assert.equal(renderer.root.findByType('table').props.style.fontSize,16);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.localStorage;}
});

test('both queue views share current data; closing one view does not remove entries',async()=>{
 const hooks=componentHooks();let renderer;const data={drivers:[{id:'a',fullName:'أحمد',active:true,status:'Available'},{id:'b',fullName:'محمد',active:true,status:'Available'}],vehicles:[],reception:{rides:[],shifts:[],queueLocations:[],queue:[{driverId:'a',position:1,joinedAt:'2026-09-28T01:28:00Z'},{driverId:'b',position:2,joinedAt:'2026-09-28T02:28:00Z'}]}};
 globalThis.__unifiedUi={api:{driverQueue:async()=>{data.reception.queue.reverse();data.reception.queue.forEach((row,i)=>row.position=i+1);}}};
 try{const {OfficeQueuePanel}=await import('../src/components/office-queue.tsx');let show=true;const refresh=async()=>renderer.update(render());const render=()=>React.createElement('main',null,React.createElement(OfficeQueuePanel,{key:'main',data,refresh,embedded:true}),show&&React.createElement(OfficeQueuePanel,{key:'floating',data,refresh,embedded:true}));await act(async()=>{renderer=TestRenderer.create(render());});const panels=()=>renderer.root.findAllByType('aside');await act(async()=>panels()[1].findAllByProps({role:'button'})[1].props.onClick());await act(async()=>panels()[1].findAllByType('button').find(b=>b.children.join('').includes('رفع')).props.onClick());assert.equal(panels()[0].findAllByProps({role:'button'})[0].props['aria-label'],'اختيار محمد');assert.equal(panels()[1].findAllByProps({role:'button'})[0].props['aria-label'],'اختيار محمد');show=false;await act(async()=>renderer.update(render()));assert.equal(panels().length,1);assert.equal(data.reception.queue.length,2);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.__unifiedUi;}
});

test('floating queue window moves, resizes, persists geometry and closes without a new session',async()=>{
 const reactUrl=JSON.stringify(import.meta.resolve('react'));const storage=new Map();let resizeCallback,renderer;globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};globalThis.document={body:{}};globalThis.innerWidth=1400;globalThis.innerHeight=900;globalThis.ResizeObserver=class{constructor(callback){resizeCallback=callback;}observe(){}disconnect(){}};
 const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 const hooks=registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/floating-queue-window.tsx')){if(specifier==='react-dom')return stub('export const createPortal=children=>children;');if(specifier==='./ui/button')return stub('export const Button="button";');}return next(specifier,context);},load(url,context,next){if(url.endsWith('/floating-queue-window.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,context);}});
 try{const {FloatingQueueWindow}=await import('../src/components/floating-queue-window.tsx');let open=true;const render=()=>React.createElement(FloatingQueueWindow,{open,onClose:()=>{open=false;renderer.update(render());}},React.createElement('p',null,'shared queue'));await act(async()=>{renderer=TestRenderer.create(render(),{createNodeMock:()=>({querySelector:()=>null})});});const dialog=()=>renderer.root.findByProps({role:'dialog'});assert.equal(dialog().props.style.resize,'both');const header=dialog().findAllByType('div').find(n=>n.props.onPointerDown);await act(async()=>header.props.onPointerDown({target:{closest:()=>null},currentTarget:{setPointerCapture(){}},pointerId:1,clientX:50,clientY:80}));await act(async()=>header.props.onPointerMove({clientX:100,clientY:120}));await act(async()=>header.props.onPointerUp());assert.equal(dialog().props.style.left,74);assert.equal(dialog().props.style.top,100);await act(async()=>resizeCallback([{target:{getBoundingClientRect:()=>({width:450,height:550})}}]));assert.equal(dialog().props.style.width,450);assert.equal(JSON.parse(storage.get('dispatchpro.queue-window.geometry.v1')).height,550);await act(async()=>renderer.root.findByType('button').props.onClick());assert.equal(renderer.toJSON(),null);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();for(const name of ['localStorage','document','innerWidth','innerHeight','ResizeObserver'])delete globalThis[name];}
});

test('request row colors follow live dispatch status updates',async()=>{
 const hooks=componentHooks();let renderer;
 try{
  const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
  const ride={id:'color-check',orderNumber:1,createdAt:new Date(),passengerName:'عميل',passengerPhone:'0000',pickup:{name:'عنوان'},status:'pending',driverId:'driver'};
  const render=patch=>React.createElement(OfficeReceptionTable,{rides:[{...ride,...patch}],drivers:[],choices:[],onAssign:async()=>{},onSave:async()=>{},onEdit:()=>{},onDuplicate:async()=>{}});
  await act(async()=>{renderer=TestRenderer.create(render({dispatchStatus:'PENDING'}));});
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='كل الطلبات').props.onClick());
  const row=()=>renderer.root.findByType('tbody').findByType('tr');
  for(const [state,color] of [['SENT','amber-100'],['ACCEPTED','green-100'],['REJECTED','orange-100'],['SENT','amber-100'],['ARRIVED','cyan-100'],['STARTED','violet-100'],['COMPLETED','gray-100'],['PENDING','yellow-50'],['CANCELLED','red-100']]){
   await act(async()=>renderer.update(render({dispatchStatus:state})));
   const classes=row().props.className.split(' ');
   assert.ok(classes.includes('text-slate-900'));
   assert.deepEqual(classes.filter(c=>c.startsWith('bg-')),[`bg-${color}`]);
   assert.ok(classes.includes(`hover:bg-${color.replace('100','200').replace('50','100')}`));
   assert.equal(row().findAllByType('td').length,10);
  }
  for(const [status,color] of [['assigned','amber-100'],['driver-accepted','green-100'],['in-progress','violet-100'],['completed','gray-100']]){
   await act(async()=>renderer.update(render({status})));
   assert.ok(row().props.className.split(' ').includes(`bg-${color}`));
  }
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

function componentHooks(){
 const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 return registerHooks({resolve(specifier,context,next){
  if(/\/(office-queue|office-reception-table|inline-office-fare|send-phone-menu)\.tsx$/.test(context.parentURL??'')){
   if(specifier==='./send-phone-menu')return next(new URL('../src/components/send-phone-menu.tsx',import.meta.url).href,context);
   if(specifier==='./ui/popover')return stub('export const Popover="div",PopoverTrigger="div",PopoverContent="section";');
   if(specifier==='./inline-office-fare')return next(new URL('../src/components/inline-office-fare.tsx',import.meta.url).href,context);
   if(specifier==='./office-workspace')return stub('export const useOffice=()=>({});');
   if(specifier==='@/lib/reception-api')return stub('export const apiReceptionBackend={driverQueue:(...args)=>globalThis.__unifiedUi.api.driverQueue(...args)};');
   if(specifier==='@hello-pangea/dnd')return stub('export const DragDropContext="div";export const Draggable=({children})=>children({innerRef:()=>{},draggableProps:{},dragHandleProps:{}});');
   if(specifier==='./strict-mode-droppable')return stub('export const StrictModeDroppable=({children})=>children({innerRef:()=>{},droppableProps:{},placeholder:null});');
   if(specifier==='./shift-picker')return stub('export const ShiftPicker="mock-picker";');
   if(specifier==='./ui/button')return stub('export const Button="button";');
   if(specifier==='./ui/input')return stub('export const Input="input";');
   if(specifier==='./ui/dialog')return stub('export const Dialog=p=>p.open?p.children:null;export const DialogContent="section",DialogTitle="h2",DialogDescription="p";');
   if(specifier.startsWith('@/'))return next(new URL('../src/'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  }return next(specifier,context);
 },load(url,context,next){if(/\/(office-queue|office-reception-table|inline-office-fare|send-phone-menu)\.tsx$/.test(url))return{format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,context);}});
}



