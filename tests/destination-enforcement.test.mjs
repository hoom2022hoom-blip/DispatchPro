import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('actual customer script rejects blank and whitespace destinations before confirmation or POST',async()=>{
 const app=await customerMobile();
 app.nodes.get('ride-form').elements.pickup.value='Customer pickup';
 for(const text of ['', '   ']){
  app.nodes.get('ride-form').elements.destination.value=text;
  await app.nodes.get('ride-form').requestSubmit();
  assert.equal(app.nodes.get('destination-error').textContent,'يرجى تحديد وجهة الرحلة');
  assert.equal(app.context.document.activeElement,app.nodes.get('open-destination'));
  assert.equal(app.calls.filter(c=>c.init.method==='POST'&&c.url.endsWith('/rides')).length,0);
 }
});

test('street form rejects whitespace, focuses destination and never calls create',async()=>{
 const hooks=receptionRenderHooks();let view;let focused=0;const writes=[];
 try{
  const {DriverStreetRideForm}=await import('../src/components/driver-street-ride-form.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverStreetRideForm,{initialPickup:{latitude:32.22,longitude:35.25},places:async()=>[],sendLocation:async()=>{},save:async value=>writes.push(value),onClose(){}}),{createNodeMock:element=>element.type==='input'?{focus(){focused++;}}:null});});
  for(const text of ['', '   ']){
   await act(async()=>view.root.findAllByType('input').find(n=>n.props['aria-required']).props.onChange({target:{value:text}}));
   await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
   assert.match(JSON.stringify(view.toJSON()),/يرجى تحديد وجهة الرحلة/);
  }
  assert.equal(writes.length,0);assert.equal(focused,2);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('real dashboard street click opens the existing form even while disconnected',async()=>{
 const hooks=receptionRenderHooks();
 const apiHook=registerHooks({resolve(s,c,next){if(s==='@/lib/driver-api')return{url:'data:text/javascript,export const createDriverApi=()=>globalThis.destinationScreenApi;export class DriverApiError extends Error{};export const noticeLabel=()=>"";',shortCircuit:true};return next(s,c);}});
 const oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 const profile={id:'driver',fullName:'Driver',status:'Available',locationStatus:'READY',locationLatitude:32.22,locationLongitude:35.25};
 globalThis.destinationScreenApi={login:async()=>profile,updates:async()=>({cursor:'test',data:{driver:profile,rides:[],jobs:[],notices:[]}}),offerNow:()=>Date.now(),places:async()=>[],location:async()=>({stored:true}),logout(){}};
 let view;
 try{
  const {DriverApiDashboard}=await import('../src/components/driver-api-dashboard.tsx');
  const {DriverStreetRideForm}=await import('../src/components/driver-street-ride-form.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverApiDashboard));});
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  await act(async()=>{navigator.onLine=false;window.dispatchEvent(new Event('offline'));});
  const button=view.root.findAllByType('button').find(b=>b.children.join('')==='راكب أو طلب من الشارع');
  assert.equal(button.props.disabled,false);
  await act(async()=>button.props.onClick());
  assert.equal(view.root.findAllByType(DriverStreetRideForm).length,1);
  assert.match(JSON.stringify(view.toJSON()),/بدء الرحلة/);
 }finally{await act(async()=>view?.unmount());apiHook.deregister();hooks.deregister();delete globalThis.destinationScreenApi;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});

test('standalone mobile bundle includes shared dialog positioning and opaque background CSS',()=>{
 const css=readFileSync(new URL('../public/driver-mobile/app.css',import.meta.url),'utf8');
 for(const rule of ['.fixed','.z-50','.bg-background','.left-','.top-','translate-x-'])assert.ok(css.includes(rule),`Missing dialog rule ${rule}`);
 const build=readFileSync(new URL('../driver-mobile/build.mjs',import.meta.url),'utf8');
 assert.match(build,/src\/components\/ui\/dialog.tsx/);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 assert.equal(scripts.predev,'npm run driver:build');assert.equal(scripts.prebuild,'npm run driver:build');
});
