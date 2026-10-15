import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {createApiReceptionBackend,decodeReceptionSnapshot} from '../src/lib/reception-api.ts';

test('HTTPS reception restores a valid shared session and navigation never logs it out',async()=>{
 const previousWindow=globalThis.window,storage=new Map(),requests=[];
 globalThis.window={location:new URL('https://office.example.test'),sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 const jwt='test.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.test';
 const snapshot={rides:[],drivers:[],vehicles:[],shifts:[],queue:[],latest:null};
 const fetchImpl=async(path,init)=>{requests.push({path,authorized:!!init.headers.Authorization});return Response.json(path.endsWith('auth/login')?{accessToken:jwt}:path.includes('latest-call')?null:path.includes('snapshot')?snapshot:{drivers:[],vehicles:[],reception:snapshot});};
 const api=createApiReceptionBackend(fetchImpl);await api.login('tenant','employee','test-only');
 const restored=createApiReceptionBackend(fetchImpl);assert.deepEqual(restored.session(),{tenant:'tenant'});
 globalThis.sessionLifecycleApi=restored;globalThis.sessionLifecycleDecode=decodeReceptionSnapshot;
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){const sources={'@/lib/reception-api':'export const apiReceptionBackend=globalThis.sessionLifecycleApi;export const decodeReceptionSnapshot=globalThis.sessionLifecycleDecode;','@/lib/reception-backend':'export const getReceptionBackend=()=>globalThis.sessionLifecycleApi;','./floating-queue-window':'export const FloatingQueueWindow="queue-window";','./office-queue':'export const OfficeQueuePanel=()=>null;export const reorderOfficeQueue=async()=>{};','./office-driver-jobs':'export const OfficeDriverJobs=()=>null;'};if(s==='next/dynamic')return{url:'data:text/javascript,export default ()=>"customer-lookup";',shortCircuit:true};if(sources[s])return{url:'data:text/javascript,'+encodeURIComponent(sources[s]),shortCircuit:true};return next(s,c);}});
 let view;
 try{
  const {ApiReception}=await import('../src/components/api-reception.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(ApiReception));});
  assert.equal(view.root.findAllByType('form').length,0,'refresh must restore reception, not show login');
  assert.ok(requests.some(r=>r.path.includes('snapshot')&&r.authorized));
  await act(async()=>view.unmount());view=null;assert.ok(restored.session(),'navigation cleared the session');
  const refreshed=createApiReceptionBackend(fetchImpl);assert.ok(refreshed.session());await refreshed.office();
  await act(async()=>{view=TestRenderer.create(React.createElement(ApiReception,{officeTenant:'tenant'}));});
  await act(async()=>view.unmount());view=null;assert.ok(refreshed.session());
  restored.logout();assert.equal(createApiReceptionBackend(fetchImpl).session(),null);
  await assert.rejects(createApiReceptionBackend(fetchImpl).office(),e=>e.status===401);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();globalThis.window=previousWindow;delete globalThis.sessionLifecycleApi;delete globalThis.sessionLifecycleDecode;}
});
