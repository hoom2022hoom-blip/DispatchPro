import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {createDriverApi} from '../src/lib/driver-api.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
import {reportCells,reportSourceLabels} from '../src/lib/office-report-export.ts';

test('street transport is driver-scoped and report source is translated',async()=>{
 const calls=[];const api=createDriverApi(async(url,init)=>{calls.push({url,...init});return Response.json(url.endsWith('auth/driver-login')?{accessToken:'driver'}:url.endsWith('driver/me')?{id:'self'}:{id:'street',status:'InProgress',version:2});});
 await api.login('office','self','test');await api.streetRide({id:'street',destination:{addressText:'Text destination',locationSource:'MANUAL_TEXT'},fareMode:'DRIVER_MANUAL'});
 const request=calls.at(-1);assert.equal(request.url,'/api/reception/driver/street-rides');assert.equal(request.headers.Authorization,'Bearer driver');assert.equal(request.method,'POST');assert.equal(JSON.parse(request.body).driverId,undefined);
 let forwarded=false;const response=await proxyReception(new Request('http://127.0.0.1:9005/api/reception/driver/street-rides',{method:'POST',headers:{Authorization:'Bearer driver'},body:request.body}),['driver','street-rides'],'http://127.0.0.1:9010',async(url,init)=>{forwarded=true;assert.equal(url,'http://127.0.0.1:9010/api/v1/driver/street-rides');assert.equal(init.headers.Authorization,'Bearer driver');return Response.json({});});assert.equal(response.status,200);assert.ok(forwarded);
 assert.equal(reportSourceLabels.DRIVER_STREET,'راكب أو طلب من الشارع');assert.ok(reportCells({source:'DRIVER_STREET'}).includes('راكب أو طلب من الشارع'));
});

test('street form supports text, active suggestions, map selection, double submit and same-id retry',async()=>{
 const hooks=receptionRenderHooks();let renderer;let writes=[];let release;let fail=true;
 const active={id:'active',name:'موقع المكتب',addressText:'عنوان المكتب',latitude:32.3,longitude:35.3,isActive:true},inactive={...active,id:'inactive',name:'Inactive',isActive:false};
 const {DriverStreetRideForm}=await import('../src/components/driver-street-ride-form.tsx');
 try{
  await act(async()=>{renderer=TestRenderer.create(React.createElement(DriverStreetRideForm,{initialPickup:{latitude:32.2,longitude:35.2},places:async()=>[active,inactive],sendLocation:async()=>{},onClose(){},save:async input=>{writes.push(input);if(fail){await new Promise(resolve=>release=resolve);throw Error('Lost response');}}}));});
  assert.match(JSON.stringify(renderer.toJSON()),/راكب أو طلب من الشارع/);assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/Inactive/);
  const field=renderer.root.findAllByType('input').find(n=>n.props['aria-required']);await act(async()=>field.props.onChange({target:{value:'Typed destination'}}));
  await act(async()=>field.props.onChange({target:{value:'المكتب'}}));
  await act(async()=>renderer.root.findAllByType('button').find(n=>n.children.join('')==='موقع المكتب · عنوان المكتب').props.onClick());
  assert.equal(renderer.root.findAllByType('input').find(n=>n.props['aria-required']).props.value,'موقع المكتب · عنوان المكتب');
  const form=renderer.root.findByType('form');const submit=form.props.onSubmit;let pending;
  await act(async()=>{pending=submit({preventDefault(){}});await submit({preventDefault(){}});});assert.equal(writes.length,1);assert.equal(writes[0].destinationPlaceId,'active');assert.equal(writes[0].pickup,undefined);assert.equal(writes[0].destination.latitude,32.3);
  await act(async()=>{release();await pending;});fail=false;await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes.length,2);assert.equal(writes[0].id,writes[1].id);
  await act(async()=>renderer.root.findAllByType('input').find(n=>n.props['aria-required']).props.onChange({target:{value:'Free text'}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes.at(-1).destinationPlaceId,undefined);assert.equal(writes.at(-1).destination.latitude,undefined);
  const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
  await act(async()=>button('تحديد الوجهة على الخريطة').props.onClick());const {LocationPointPicker}=await import('../src/components/location-point-picker.tsx');
  await act(async()=>renderer.root.findByType(LocationPointPicker).props.onChange({latitude:32.4,longitude:35.4}));await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes.at(-1).destination.latitude,32.4);assert.equal(writes.at(-1).destinationPlaceId,undefined);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

test('street GPS uses only a fresh precise captured fix and never invents a pickup',async()=>{
 const hooks=receptionRenderHooks();const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');let renderer;const locations=[];let callback;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(success){callback=success;}}}});
 try{
  const {DriverStreetRideForm}=await import('../src/components/driver-street-ride-form.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(DriverStreetRideForm,{places:async()=>[],sendLocation:async value=>{locations.push(value);return{stored:true};},save:async()=>{},onClose(){}}));});
  assert.match(JSON.stringify(renderer.toJSON()),/بانتظار GPS أو اختيار نقطة/);
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='استخدام GPS الحالي').props.onClick());
  await act(async()=>callback({timestamp:Date.now(),coords:{latitude:32.2,longitude:35.2,accuracy:500}}));assert.equal(locations.length,0);
  const gps=()=>renderer.root.findAllByType('button').find(b=>b.children.join('')==='استخدام GPS الحالي');await act(async()=>gps().props.onClick());
  await act(async()=>callback({timestamp:Date.now()-120000,coords:{latitude:32.2,longitude:35.2,accuracy:10}}));assert.equal(locations.length,0);
  await act(async()=>gps().props.onClick());const captured=Date.now();await act(async()=>callback({timestamp:captured,coords:{latitude:32.2,longitude:35.2,accuracy:10}}));
  assert.deepEqual(locations,[{latitude:32.2,longitude:35.2,accuracy:10,capturedAt:new Date(captured).toISOString()}]);assert.match(JSON.stringify(renderer.toJSON()),/32.200000, 35.200000/);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
});
