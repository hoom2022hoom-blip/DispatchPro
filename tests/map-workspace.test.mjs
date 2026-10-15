import test from 'node:test';import assert from 'node:assert/strict';import{registerHooks}from'node:module';import React from'react';import TestRenderer,{act}from'react-test-renderer';import{receptionRenderHooks}from'./helpers/reception-render.mjs';
test('map workspace starts collapsed, persists sidebar choice and retains one queue window through navigation',async()=>{
 const hooks=receptionRenderHooks(),react=JSON.stringify(import.meta.resolve('react'));
 const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 const custom=registerHooks({resolve(s,c,next){
  if(s==='next/navigation')return stub('export const usePathname=()=>globalThis.workspacePath;export const useRouter=()=>({replace(){}});');
  if(s==='next/link')return stub('export default "a";');
  if(s==='@/hooks/use-office-auth')return stub('export const useOfficeAuth=()=>({authReady:true,authenticated:true,tenant:"test"});');
  if(s==='@/lib/reception-api')return stub('export const apiReceptionBackend=globalThis.workspaceApi;');
  if(c.parentURL?.endsWith('/office-workspace.tsx')){
   if(s==='@/components/ui/sheet')return stub(`import React from ${react};export const Sheet=p=>p.children;export const SheetContent='div',SheetTitle='span',SheetTrigger='div';`);
   if(s==='./office-live-notifications')return stub('export const OfficeLiveNotifications=()=>null;');
   if(s==='./floating-queue-window')return stub(`import React from ${react};export const FloatingQueueWindow=p=>React.createElement('queue-window',p,p.children);`);
   if(s==='./office-queue')return stub('export const OfficeQueuePanel=()=>null;export const reorderOfficeQueue=async()=>{};');
  }
  return next(s,c);
 }});
 const previousWindow=globalThis.window;globalThis.window=new EventTarget();const original=globalThis.localStorage,storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.workspacePath='/office/driver-map';globalThis.workspaceApi={authSnapshot:()=>({authenticated:true}),session:()=>({tenant:'test'}),office:async()=>({drivers:[],vehicles:[],reception:{rides:[],queue:[],shifts:[]}})};
 let view;
 try{const{OfficeWorkspace,useOffice}=await import('../src/components/office-workspace.tsx');const Child=()=>React.createElement('button',{onClick:useOffice().openQueueWindow},'queue');const render=()=>React.createElement(OfficeWorkspace,null,React.createElement(Child));
  await act(async()=>{view=TestRenderer.create(render());});
  const menu=()=>view.root.findAllByType('button').find(b=>b.props['aria-label']==='قائمة المكتب');assert.ok(menu());assert.equal(view.root.findAllByProps({'aria-label':'طي لوحة المكتب'}).length,0);
  assert.equal(view.root.findAllByType('queue-window').length,1);assert.equal(view.root.findByType('queue-window').props.open,false);
  await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='queue').props.onClick());assert.equal(view.root.findByType('queue-window').props.open,false);
  globalThis.workspacePath='/office/orders';await act(async()=>view.update(render()));await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='queue').props.onClick());const queue=view.root.findByType('queue-window');assert.equal(queue.props.open,true);
  globalThis.workspacePath='/office/reports';await act(async()=>view.update(render()));assert.equal(view.root.findByType('queue-window'),queue);assert.equal(queue.props.open,true);
  globalThis.workspacePath='/office/driver-map';await act(async()=>view.update(render()));assert.equal(queue.props.open,false);assert.ok(menu());assert.equal(storage.size,0);
 }finally{await act(async()=>view?.unmount());custom.deregister();hooks.deregister();globalThis.localStorage=original;globalThis.window=previousWindow;delete globalThis.workspacePath;delete globalThis.workspaceApi;}
});
