import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('new password requires eight characters, temporary password is issued by server and dismissible',async()=>{
 const hooks=receptionRenderHooks();const saved=[];
 globalThis.nmAccountApi={driverMap:async()=>({drivers:[{id:'driver',driverAppEnabled:true,radioEnabled:true,gpsEnabled:true}]}),administration:async(path,method,input)=>{saved.push({path,method,input});return{temporaryPassword:input.generateTemporary?'TEST-once-12345':null};}};
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.nmAccountApi;',shortCircuit:true};return next(s,c);}});
 let view;
 try {
  const {DriverAccountPanel}=await import('../src/components/driver-account-panel.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverAccountPanel,{driverId:'driver',state:{username:'central',accountActive:true,available:false,locationStatus:'NO_LOCATION',reasons:[]},refresh:async()=>{}}));});
  const button=name=>view.root.findAllByType('button').find(b=>b.children.join('')===name);
  const password=()=>view.root.findByProps({autoComplete:'new-password'});
  assert.equal(password().props.minLength,8);await act(async()=>password().props.onChange({target:{value:'1234567'}}));assert.equal(button('حفظ الحساب / تعيين كلمة المرور').props.disabled,true);
  await act(async()=>password().props.onChange({target:{value:'12345678'}}));assert.equal(button('حفظ الحساب / تعيين كلمة المرور').props.disabled,false);
  await act(async()=>button('إظهار كلمة المرور').props.onClick());assert.equal(password().props.type,'text');
  await act(async()=>button('إنشاء وتعيين كلمة مؤقتة').props.onClick());assert.deepEqual(saved[0].input,{username:'central',active:true,generateTemporary:true});assert.equal(view.root.findByType('output').children.join(''),'TEST-once-12345');assert.equal(password().props.value,'');
  await act(async()=>button('إغلاق العرض').props.onClick());assert.equal(view.root.findAllByType('output').length,0);
 } finally {await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.nmAccountApi;}
});
