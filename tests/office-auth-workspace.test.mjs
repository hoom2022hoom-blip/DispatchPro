import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';import {createApiReceptionBackend} from '../src/lib/reception-api.ts';
test('Office workspace gates protected children until auth is ready and shares auth across History and Drivers navigation',async()=>{
 const old=globalThis.window,storage=new Map(),calls=[];globalThis.window={addEventListener(){},removeEventListener(){},location:new URL('https://office.example.test'),sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 const originalNow=Date.now,serverNow=Date.now();
 const token='test.'+Buffer.from(JSON.stringify({exp:serverNow/1000+300,tenant:'tenant',sub:'employee'})).toString('base64url')+'.test';
 Date.now=()=>serverNow+3600000;
 const data={today:'2026-10-03',drivers:[],vehicles:[],calls:[],reception:{rides:[],drivers:[],vehicles:[],shifts:[],queue:[],latest:null}};
 const api=createApiReceptionBackend(async(path,init)=>{calls.push({path,auth:!!init.headers.Authorization,ready:api.authSnapshot().authReady});return Response.json(path.endsWith('auth/login')?{accessToken:token}:data,{headers:{Date:new Date(serverNow).toUTCString()}});});let releaseRestore;const restore=api.bootstrap;api.bootstrap=async()=>{await new Promise(r=>releaseRestore=r);return restore();};globalThis.workspaceAuthApi=api;
 const hooks=receptionRenderHooks();const react=JSON.stringify(import.meta.resolve('react'));
 const stub=registerHooks({resolve(s,c,next){const sources={'@/lib/reception-api':'export const apiReceptionBackend=globalThis.workspaceAuthApi;','next/navigation':'export const usePathname=()=>"/office/orders";export const useRouter=()=>({replace(){}});','next/link':`import React from ${react};export default p=>React.createElement('a',p,p.children);`,'@/components/ui/sheet':'export const Sheet=p=>p.children,SheetContent=p=>p.children,SheetTitle=p=>p.children,SheetTrigger=p=>p.children;','./ui/sheet':'export const Sheet=p=>p.children,SheetContent=p=>p.children,SheetTitle=p=>p.children,SheetTrigger=p=>p.children;','./office-queue':'export const OfficeQueuePanel=()=>null;export const reorderOfficeQueue=async()=>{};','./floating-queue-window':'export const FloatingQueueWindow=()=>null;'};if(sources[s])return{url:'data:text/javascript,'+encodeURIComponent(sources[s]),shortCircuit:true};return next(s,c);}});
 let view;const visits=[];
 function ProtectedPage({name}){React.useEffect(()=>{visits.push(name);void api.administration(name==='history'?'customers/customer/history':name==='drivers'?'office':'reception/snapshot');},[name]);return React.createElement('protected-page',{name});}
 try{
  const {OfficeWorkspace}=await import('../src/components/office-workspace.tsx');
  const tree=name=>React.createElement(OfficeWorkspace,null,React.createElement(ProtectedPage,{name}));
  await act(async()=>{view=TestRenderer.create(tree('reception'));});assert.equal(visits.length,0);assert.equal(calls.length,0);assert.equal(view.root.findAllByType('form').length,0);assert.match(JSON.stringify(view.toJSON()),/جارٍ استعادة جلسة المكتب/);await act(async()=>{releaseRestore();await new Promise(setImmediate);});api.bootstrap=restore;
  for(const [auto,value] of [['username','user'],['current-password','test-only']])await act(async()=>view.root.findByProps({autoComplete:auto}).props.onChange({target:{value}}));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  for(let i=0;i<5&&!visits.length;i++)await act(async()=>new Promise(r=>setTimeout(r,20)));
  assert.deepEqual(visits,['reception'],JSON.stringify({auth:api.authSnapshot(),calls,view:view.toJSON()}));
  for(const page of ['history','reception','drivers','reception'])await act(async()=>view.update(tree(page)));
  assert.deepEqual(visits,['reception','history','reception','drivers','reception']);
  assert.ok(calls.filter(c=>!c.path.endsWith('auth/login')).every(c=>c.auth&&c.ready));
  await act(async()=>view.unmount());view=null;assert.ok(api.authSnapshot().authenticated);
  const restored=createApiReceptionBackend(async()=>Response.json(data));await restored.bootstrap();assert.ok(restored.authSnapshot().authenticated);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();globalThis.window=old;Date.now=originalNow;delete globalThis.workspaceAuthApi;}
});
