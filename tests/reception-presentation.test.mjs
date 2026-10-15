import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {driverGroups,driverPresentation} from '../src/lib/driver-presentation.ts';

test('driver presentation shares colors and busy counts; an active trip outranks a pending offer',()=>{
 const driver={id:'driver',active:true,status:'Available'};
 assert.equal(driverPresentation(driver,[]).driverGroup,0);
 assert.equal(driverPresentation(driver,[{driverId:'driver',status:'assigned'}]).driverGroup,1);
 assert.deepEqual(driverPresentation(driver,[{driverId:'driver',status:'assigned'},{driverId:'driver',status:'in-progress'},{queuedDriverId:'driver'},{queuedDriverId:'driver'}]),{driverGroup:2,waitingCount:2});
 assert.equal(driverPresentation({...driver,status:'Offline'},[]).driverGroup,3);
 assert.deepEqual(driverGroups.map(group=>group.color.split(' ')[0]),['bg-emerald-50','bg-orange-50','bg-red-50','bg-slate-100']);
});

test('offline group starts collapsed for many drivers, remembers expansion and reveals search results',async()=>{
 const hooks=receptionRenderHooks();const previousWindow=globalThis.window;globalThis.window=new EventTarget();let renderer;
 try{
  const {ConnectedDrivers}=await import('../src/components/connected-drivers.tsx');
  const drivers=Array.from({length:6},(_,i)=>({id:String(i),fullName:`سائق ${i}`,active:true,status:'Offline'}));
  const render=()=>React.createElement(ConnectedDrivers,{drivers,rides:[]});
  await act(async()=>{renderer=TestRenderer.create(render());});
  const group=()=>renderer.root.findByProps({'aria-label':'غير متصل'});
  assert.equal(group().findByType('ul').props.hidden,true);
  await act(async()=>group().findByType('button').props.onClick());
  await act(async()=>renderer.update(render()));
  assert.equal(group().findByType('ul').props.hidden,false);
  await act(async()=>group().findByType('button').props.onClick());
  await act(async()=>renderer.root.findByType('input').props.onChange({target:{value:'سائق 2'}}));
  assert.equal(group().findByType('ul').props.hidden,false);
  assert.equal(group().findAllByType('li').length,1);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

test('picker groups drivers with counts, shows busy waiting count, and preserves selection eligibility',async()=>{
 const hooks=receptionRenderHooks();let renderer;const selected=[];
 try{
  const {ShiftPicker}=await import('../src/components/shift-picker.tsx');
  const choices=[0,1,2,3].map(group=>({id:String(group),driverId:String(group),label:`سائق ${group}`,driverGroup:group,waitingCount:3,disabled:group===3}));
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ShiftPicker,{value:'',choices,allowClear:false,initialOpen:true,onChange:id=>selected.push(id)}));});
  assert.deepEqual(renderer.root.findAllByType('h3').map(n=>n.findAllByType('span')[0].children.join('')),driverGroups.map(g=>g.label));
  const buttons=renderer.root.findByType('section').findAllByType('button');
  assert.equal(buttons[2].findAllByType('span')[1].children.join(''),'مشغول | انتظار 3');
  assert.equal(buttons[2].props.disabled,false);assert.equal(buttons[3].props.disabled,true);
  await act(async()=>buttons[2].props.onClick());assert.deepEqual(selected,['2']);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

test('office owns one persistent queue across route changes and keeps drag handling available',async()=>{
 const hooks=receptionRenderHooks();const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 const react=JSON.stringify(import.meta.resolve('react'));
 globalThis.queueUi={path:'/office/orders',moves:[],drops:[],data:{drivers:[],vehicles:[],reception:{queue:[]}}};
 const overrides=registerHooks({resolve(s,c,next){
  if(s==='next/navigation')return stub('export const usePathname=()=>globalThis.queueUi.path;export const useRouter=()=>({replace(){}});');
  if(s==='next/link')return stub('export default "a";');
  if(s==='@hello-pangea/dnd')return stub('export const DragDropContext="dnd";');
  if(s==='@/lib/reception-api')return stub('const auth={authReady:true,authenticated:true,tenant:"test"};export const apiReceptionBackend={authSnapshot:()=>auth,subscribeAuth:()=>()=>{},bootstrap:async()=>{},session:()=>({tenant:"test"}),office:async()=>globalThis.queueUi.data};');
  if(s==='./office-live-notifications')return stub('export const OfficeLiveNotifications=()=>null;');
  if(s==='@/components/ui/sheet')return stub('export const Sheet="sheet",SheetContent="sheet-content",SheetTitle="h2",SheetTrigger="sheet-trigger";');
  if(s==='./floating-queue-window')return stub(`import React from ${react};export const FloatingQueueWindow=p=>p.open?React.createElement('queue-window',{onClose:p.onClose},p.children):null;`);
  if(s==='./office-queue')return stub('export const OfficeQueuePanel="queue-panel";export const reorderOfficeQueue=async result=>globalThis.queueUi.moves.push(result);');
  return next(s,c);
 }});
 const previousWindow=globalThis.window;globalThis.window=new EventTarget();let renderer;
 try{
  const {OfficeWorkspace,useOffice}=await import('../src/components/office-workspace.tsx');
  function Page(){const office=useOffice();React.useEffect(()=>{if(globalThis.queueUi.path==='/office/orders'){office.registerReceptionDrop(result=>globalThis.queueUi.drops.push(result));return()=>office.registerReceptionDrop(null);}},[office.registerReceptionDrop]);return React.createElement('button',{id:'open-queue',onClick:office.openQueueWindow},'قائمة الدور');}
  const render=()=>React.createElement(OfficeWorkspace,null,React.createElement(Page,{key:globalThis.queueUi.path}));
  await act(async()=>{renderer=TestRenderer.create(render());});
  await act(async()=>{renderer.root.findByProps({id:'open-queue'}).props.onClick();renderer.root.findByProps({id:'open-queue'}).props.onClick();});
  const original=renderer.root.findByType('queue-window');
  await act(async()=>renderer.root.findByType('dnd').props.onDragEnd({draggableId:'queue-floating:a',destination:{droppableId:'ride:r'}}));
  assert.equal(globalThis.queueUi.drops.length,1);
  for(const path of ['/office/reports','/office/drivers','/office/vehicles','/office/orders']){
   globalThis.queueUi.path=path;await act(async()=>renderer.update(render()));
   assert.equal(renderer.root.findAllByType('queue-window').length,1);
   assert.equal(renderer.root.findByType('queue-window'),original);
   if(path==='/office/reports'){
    await act(async()=>renderer.root.findByType('dnd').props.onDragEnd({destination:{droppableId:'driver-queue-floating'}}));
    assert.equal(globalThis.queueUi.moves.length,1);
   }
  }
  await act(async()=>renderer.root.findByType('queue-window').props.onClose());
  assert.equal(renderer.root.findAllByType('queue-window').length,0);
 }finally{await act(async()=>renderer?.unmount());overrides.deregister();hooks.deregister();delete globalThis.queueUi;globalThis.window=previousWindow;}
});
