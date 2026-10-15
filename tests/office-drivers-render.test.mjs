import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

test('driver editor submits full local contact/profile data, preserves long address and renders plate', async()=>{
 const state={data:{officeWhatsAppNumber:'',drivers:[],vehicles:[{id:'car-internal',plate:'39-123-45',make:'Kia',model:'Niro'}],reception:{queue:[],queueLocations:[],rides:[],shifts:[]}},refresh:async()=>{}};
 const saved=[];globalThis.__officeDriverTest={state,api:{driverAssignments:async()=>[],saveOfficeRecord:async(kind,value)=>saved.push({kind,value})}};
 const stub=source=>'data:text/javascript,'+encodeURIComponent(source);
 const hooks=registerHooks({
  resolve(specifier,context,next){
   if(context.parentURL?.includes('/office-drivers.tsx')) {
    if(specifier==='./driver-account-panel')return {url:stub('export const DriverAccountPanel=()=>null;'),shortCircuit:true};
    if(specifier==='./office-driver-voice-access')return {url:stub('export const OfficeDriverVoiceAccess=()=>null;'),shortCircuit:true};
    if(specifier==='./office-workspace')return {url:stub('export const useOffice=()=>globalThis.__officeDriverTest.state;'),shortCircuit:true};
    if(specifier==='@/lib/reception-api')return {url:stub('export const apiReceptionBackend=globalThis.__officeDriverTest.api;'),shortCircuit:true};
    if(specifier==='@/lib/office')return next(new URL('../src/lib/office.ts',import.meta.url).href,context);
    if(specifier==='@/lib/whatsapp-link')return next(new URL('../src/lib/whatsapp-link.ts',import.meta.url).href,context);
    if(specifier==='next/link')return {url:stub('export default "a";'),shortCircuit:true};
    if(specifier==='./ui/button')return {url:stub('export const Button="button";'),shortCircuit:true};
    if(specifier==='./ui/input')return {url:stub('export const Input="input";'),shortCircuit:true};
   }
   return next(specifier,context);
  },
  load(url,context,next){if(url.endsWith('/office-drivers.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,context);}
 });
 let renderer;
 try {
  const {OfficeDrivers}=await import('../src/components/office-drivers.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeDrivers));});
  const headers=renderer.root.findAllByType('th').map(n=>n.children.join(''));
  for(const field of ['موقع الدور','رقم الدور','وقت الدخول'])assert.ok(!headers.includes(field));
  const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
  const field=label=>renderer.root.findAllByType('label').find(n=>n.children[0]===label).findByType('input');
  await act(async()=>button('إضافة سائق').props.onClick());
  const set=async(label,value)=>act(async()=>field(label).props.onChange({target:{value}}));
  await set('الاسم الكامل','محمد أحمد'); await set('الهاتف المحلي (دون رمز دولة)','0591234567');
  await set('رقم الهوية','ID-123');await set('رقم الرخصة','LICENSE-123');
  const address='عنوان يدوي طويل\n'.repeat(700);
  assert.equal(renderer.root.findAllByType('textarea')[0].props.maxLength,undefined);
  await act(async()=>renderer.root.findAllByType('textarea')[0].props.onChange({target:{value:address}}));
  await act(async()=>button('استخدام الهاتف المحلي نفسه').props.onClick());
  const country=renderer.root.findAllByType('select').find(n=>n.props.value==='+970');
  await act(async()=>country.props.onChange({target:{value:'+972'}}));
  const checkbox=text=>renderer.root.findAllByType('label').find(n=>n.children.includes(text)).findByType('input');
  await act(async()=>checkbox(' لديه WhatsApp').props.onChange({target:{checked:true}}));
  await act(async()=>checkbox(' السماح برسائل WhatsApp لاحقًا').props.onChange({target:{checked:true}}));
  const vehicle=renderer.root.findAllByType('select').find(n=>n.findAllByType('option').some(o=>o.props.value==='car-internal'));
  assert.ok(vehicle.findAllByType('option').some(o=>o.children.join('').includes('39-123-45 | Kia Niro')));
  await act(async()=>vehicle.props.onChange({target:{value:'car-internal'}}));
  await act(async()=>renderer.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
  assert.equal(saved.length,1);const value=saved[0].value;
  assert.equal(value.phoneLocal,'0591234567');assert.equal(value.whatsappPhone,'0591234567');assert.equal(value.whatsappCountryCode,'+972');
  assert.equal(value.hasWhatsApp,true);assert.equal(value.whatsappEnabled,true);assert.equal(value.address,address);
  assert.equal(value.nationalId,'ID-123');assert.equal(value.licenseNumber,'LICENSE-123');assert.equal(value.currentVehicleId,'car-internal');
  assert.equal(value.dateOfBirth,null);
 } finally {await act(async()=>renderer?.unmount());hooks.deregister();delete globalThis.__officeDriverTest;}
});
