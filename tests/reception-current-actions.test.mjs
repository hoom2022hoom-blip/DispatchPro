import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {changeDispatch} from '../src/lib/office-dispatch.ts';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('Send without address: creation, editing and sending preserve empty address',async()=>{
 const hooks=receptionRenderHooks();const pickerStub=registerHooks({resolve(s,c,next){if(c.parentURL?.endsWith('/call-logger-form.tsx')&&s==='./shift-picker')return {url:'data:text/javascript,export const ShiftPicker=()=>null;',shortCircuit:true};return next(s,c);}});let renderer;const saved=[];
 try {
  const {applyReceptionEdit}=await import('../src/lib/reception-editor.ts');
  const {CallLoggerForm}=await import('../src/components/call-logger-form.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(CallLoggerForm,{optionalAddress:true,onAddRide:r=>saved.push(r),onEditRide:async()=>{}}));});
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){},persist(){}}));
  assert.equal(saved.length,1);assert.equal(saved[0].pickup.name,'');
  const ride={...saved[0],driverId:'a',receptionPending:true};
  assert.equal(changeDispatch(ride,'SENT').status,'assigned');
  assert.equal(changeDispatch(ride,'SENT').receptionPending,false);
  assert.equal(applyReceptionEdit(ride,{passengerName:'',address:'',addressStatus:'default',notes:'',status:'pending'},true).pickup.name,'');
  assert.throws(()=>changeDispatch({...ride,driverId:null},'SENT'),/السائق/);
 } finally {await act(async()=>renderer?.unmount());pickerStub.deregister();hooks.deregister();}
});

function hooksForActions(){
 const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 const react=JSON.stringify(import.meta.resolve('react'));
 return registerHooks({resolve(s,c,next){
  if(s==='next/navigation')return stub('const p=new URLSearchParams();export const useSearchParams=()=>p;');
  if(s==='next/dynamic')return stub('export default ()=>()=>null;');
  if(s==='@hello-pangea/dnd')return stub('export const DragDropContext="dnd";export const Draggable=p=>p.children({innerRef:()=>{},draggableProps:{},dragHandleProps:{}});');
  if(s==='@/lib/reception-api')return stub('export const apiReceptionBackend=new Proxy({},{get:(_target,key)=>globalThis.actionApi[key]});export const decodeReceptionSnapshot=x=>x;');
  if(s==='@/lib/reception-backend')return stub('export const getReceptionBackend=()=>new Proxy({},{get:(_target,key)=>globalThis.actionApi[key]});');
  if(s==='./ui/popover')return stub(`import React from ${react};const C=React.createContext(null);export const Popover=p=>React.createElement(C.Provider,{value:p},p.children);export const PopoverTrigger=p=>{const c=React.useContext(C);return React.cloneElement(p.children,{onClick:()=>c.onOpenChange(!c.open)});};export const PopoverContent=p=>React.useContext(C).open?React.createElement('section',p):null;`);
  if(s==='./ui/button')return stub('export const Button="button";');
  if(s==='./ui/input')return stub('export const Input="input";');
  if(s==='./strict-mode-droppable')return stub('export const StrictModeDroppable=p=>p.children({innerRef:()=>{},droppableProps:{},placeholder:null});');
  if(s==='./office-workspace')return stub('export const useOffice=()=>({});');
  if(c.parentURL?.endsWith('/api-reception.tsx')&&['./floating-queue-window','./reception-footer','./reception-edit-form','./call-logger-form','./responsive-dialog','./location-fields'].includes(s)) {
   const names={'./floating-queue-window':'FloatingQueueWindow','./reception-footer':'ReceptionFooter','./reception-edit-form':'ReceptionEditForm','./call-logger-form':'CallLoggerForm','./responsive-dialog':'ResponsiveDialog','./location-fields':'LocationFields'};
   return stub(`export const ${names[s]}=()=>null;`);
  }
  if(c.parentURL?.endsWith('/api-reception.tsx')&&s==='./office-reception-table')return stub('export const OfficeReceptionTable="requests";');
  let url;if(s.startsWith('@/'))url=new URL('../src/'+s.slice(2),import.meta.url);else if(s.startsWith('.')&&c.parentURL?.includes('/src/'))url=new URL(s,c.parentURL);
  if(url)for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(url.href+ext)))return next(url.href+ext,c);
  return next(s,c);
 },load(url,c,next){if(url.includes('/src/')&&url.endsWith('.tsx'))return{format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
}

test('Requested fixes: landline on HTTP and queue search close',async()=>{
 const data={drivers:[{id:'a',fullName:'سائق',active:true,status:'Available'}],vehicles:[],reception:{rides:[],drivers:[],vehicles:[],shifts:[],queueLocations:[{id:'l',name:'المكتب',isActive:true,sortOrder:0}],queue:[],latest:null}};
 const hooks=hooksForActions();let renderer,queue;
 const original=Object.getOwnPropertyDescriptor(globalThis.crypto,'randomUUID');
 Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined,configurable:true});
 globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
 globalThis.actionApi={watchLatest:()=>()=>{},subscribe:next=>{next(structuredClone(data.reception));return()=>{};},office:async()=>structuredClone(data),saveRide:async r=>data.reception.rides.push({...r,orderNumber:data.reception.rides.length+1})};
 try {
  const {ApiReception}=await import('../src/components/api-reception.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ApiReception,{officeTenant:'test'}));});
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='أرضي').props.onClick());
  const r=data.reception.rides[0];assert.equal(r.passengerPhone,'0000');assert.equal(r.passengerName,'أرضي');assert.equal(r.driverId,null);assert.equal(r.customerId,undefined);assert.equal(r.pickup.name,'');assert.equal(r.status,'pending');assert.ok(Date.now()-r.createdAt.getTime()<5000);assert.equal(renderer.root.findByType('requests').props.rides.at(-1).id,r.id);
  const {OfficeQueuePanel}=await import('../src/components/office-queue.tsx');
  await act(async()=>{queue=TestRenderer.create(React.createElement(OfficeQueuePanel,{data,refresh:async()=>{}}));});
  const input=()=>queue.root.findByProps({'aria-label':'بحث السائقين للدور'});
  await act(async()=>input().props.onFocus());await act(async()=>queue.root.findByProps({role:'option'}).props.onClick());
  await act(async()=>input().props.onFocus());await act(async()=>queue.root.findByProps({'aria-label':'إغلاق بحث السائقين'}).props.onClick());
  assert.equal(queue.root.findAllByProps({role:'listbox'}).length,0);assert.equal(input().props.value,'سائق');assert.deepEqual(data.reception.queue,[]);
 }finally{await act(async()=>{renderer?.unmount();queue?.unmount();});if(original)Object.defineProperty(globalThis.crypto,'randomUUID',original);else delete globalThis.crypto.randomUUID;delete globalThis.actionApi;delete globalThis.localStorage;hooks.deregister();}
});

test('Drag removal, renumber, landline button, queue sizes and click reassignment',async()=>{
 const data={drivers:['a','b','c'].map(id=>({id,fullName:id,active:true,status:'Available'})),vehicles:[],reception:{rides:[],drivers:[],vehicles:[],shifts:[],queueLocations:[],queue:[],latest:null}};
 const calls=[];let reject=false,renderer,queueRenderer,pickerRenderer;
 globalThis.actionApi={watchLatest:()=>()=>{},subscribe:next=>{next(structuredClone(data.reception));return()=>{};},office:async()=>structuredClone(data),saveRide:async ride=>{calls.push(['save',ride]);if(reject)throw Error('assignment failed');const i=data.reception.rides.findIndex(r=>r.id===ride.id);if(i<0)data.reception.rides.push({...ride,orderNumber:data.reception.rides.length+1});else data.reception.rides[i]=ride;},driverQueue:async action=>{calls.push(['queue',action]);data.reception.queue=data.reception.queue.filter(q=>q.driverId!==action.driverId).map((q,i)=>({...q,position:i+1}));}};
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 const hooks=hooksForActions();
 try {
  const {ApiReception}=await import('../src/components/api-reception.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ApiReception,{officeTenant:'test'}));});
  const landline=()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='أرضي');
  await act(async()=>landline().props.onClick());
  const first=data.reception.rides[0];assert.equal(first.passengerName,'أرضي');assert.equal(first.passengerPhone,'0000');assert.equal(first.pickup.name,'');assert.equal(first.driverId,null);assert.equal(first.status,'pending');assert.equal(first.customerId,undefined);assert.ok(Date.now()-first.createdAt.getTime()<5000);
  assert.equal(renderer.root.findByType('requests').props.rides.at(-1).id,first.id);
  for(const prefix of ['queue','queue-floating']){
   await act(async()=>landline().props.onClick());const ride=data.reception.rides.at(-1);
   data.reception.queue=['a','b','c'].map((driverId,i)=>({driverId,position:i+1}));
   const drag=()=>renderer.root.findByType('dnd').props.onDragEnd({draggableId:`${prefix}:b`,destination:{droppableId:`ride:${ride.id}`,index:0}});
   reject=true;await act(async()=>drag());assert.equal(data.reception.queue.length,3);
   reject=false;await act(async()=>drag());assert.equal(data.reception.rides.at(-1).driverId,'b');assert.deepEqual(data.reception.queue.map(q=>[q.driverId,q.position]),[['a',1],['c',2]]);assert.equal(calls.at(-2)[0],'save');assert.equal(calls.at(-1)[0],'queue');
  }
  const {ShiftPicker}=await import('../src/components/shift-picker.tsx');
  const renderPicker=()=>React.createElement(ShiftPicker,{value:data.reception.rides[0].driverId??'',choices:data.drivers.map(d=>({id:d.id,label:d.fullName})),onChange:async id=>renderer.root.findByType('requests').props.onAssign(first.id,id)});
  await act(async()=>{pickerRenderer=TestRenderer.create(renderPicker());});
  const open=async()=>act(async()=>pickerRenderer.root.findByProps({'aria-label':'اختيار السائق'}).props.onClick());
  await open();assert.equal(pickerRenderer.root.findByType('section').findAllByType('button').length,4);
  const select=async id=>act(async()=>pickerRenderer.root.findByType('section').findAllByType('button').find(b=>b.children.includes(id)).props.onClick());
  const queueBefore=JSON.stringify(data.reception.queue);await select('a');assert.equal(data.reception.rides[0].driverId,'a');
  await act(async()=>pickerRenderer.update(renderPicker()));await open();assert.equal(pickerRenderer.root.findByType('input').props.value,'');await select('c');assert.equal(data.reception.rides[0].driverId,'c');assert.equal(data.reception.rides[0].reassignmentLog.at(-1).previousDriverId,'a');assert.equal(JSON.stringify(data.reception.queue),queueBefore);
  const {OfficeQueuePanel}=await import('../src/components/office-queue.tsx');
  data.reception.queue=Array.from({length:40},(_,i)=>({driverId:`driver-${i}`,position:i+1}));
  const renderQueue=()=>React.createElement(OfficeQueuePanel,{data,refresh:async()=>{},embedded:true});
  await act(async()=>{queueRenderer=TestRenderer.create(renderQueue());});
  assert.equal(queueRenderer.root.findAllByProps({role:'button'}).length,40);
  assert.ok(queueRenderer.root.findAllByType('div').some(n=>n.props.className?.includes('flex-1 overflow-auto')));
  const resize=async(label,start,end)=>{const h=queueRenderer.root.findByProps({'aria-label':label});await act(async()=>h.props.onPointerDown({currentTarget:{setPointerCapture(){}},pointerId:1,clientX:start}));await act(async()=>h.props.onPointerUp({clientX:end}));};
  await resize('Queue panel width',200,260);assert.equal(queueRenderer.root.findByType('aside').props.style.width,340);
  for(let i=1;i<=4;i++)await resize(`Queue column ${i} width`,200,190);
  const sizes=JSON.parse(storage.get('dispatchpro.queue.sizes.v1'));assert.deepEqual(sizes.columns,[38,110,90,62]);
  await act(async()=>queueRenderer.unmount());await act(async()=>{queueRenderer=TestRenderer.create(renderQueue());});assert.equal(queueRenderer.root.findByType('aside').props.style.width,340);
  assert.ok(queueRenderer.root.findAllByType('div').some(n=>n.props.style?.gridTemplateColumns==='38px 110px 90px 62px'));
  await act(async()=>queueRenderer.root.findByProps({'aria-label':'Reset queue sizes'}).props.onClick());assert.deepEqual(JSON.parse(storage.get('dispatchpro.queue.sizes.v1')),{columns:[28,100,80,52],width:280});
 }finally{await act(async()=>{renderer?.unmount();queueRenderer?.unmount();pickerRenderer?.unmount();});hooks.deregister();delete globalThis.actionApi;delete globalThis.localStorage;}
});
