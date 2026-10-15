import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('driver editor protects started pickup, writes destination on same version once and clears coordinates for text',async()=>{
 const hooks=receptionRenderHooks();let renderer;const writes=[];let closed=0;
 try{
  const {RideLocationEditor}=await import('../src/components/ride-location-editor.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(RideLocationEditor,{ride:{id:'existing-ride',status:'InProgress',version:9,pickup:'original',destination:'old',latitude:32,longitude:35,destinationLatitude:32.1,destinationLongitude:35.1},places:async()=>[],save:async input=>{writes.push(input);await new Promise(r=>setImmediate(r));},onClose:()=>closed++}));});
  const inputs=renderer.root.findAllByType('input');assert.equal(inputs[0].props.disabled,true);
  await act(async()=>inputs[1].props.onChange({target:{value:'new text destination'}}));
  const submit=renderer.root.findByType('form').props.onSubmit;await act(async()=>{const first=submit({preventDefault(){}});submit({preventDefault(){}});await first;});
  assert.deepEqual(writes,[{version:9,destination:{addressText:'new text destination',locationSource:'MANUAL_TEXT'}}]);assert.equal(closed,1);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

test('driver suggested selection sends office coordinates and keeps pickup unchanged',async()=>{
 const hooks=receptionRenderHooks();let renderer;const writes=[];
 try{
  const {RideLocationEditor}=await import('../src/components/ride-location-editor.tsx');
  await act(async()=>{renderer=TestRenderer.create(React.createElement(RideLocationEditor,{ride:{id:'existing',status:'Accepted',version:4,pickup:'pickup',destination:'old'},places:async()=>[{id:'place',isActive:true,name:'موقع المكتب',addressText:'عنوان المكتب',latitude:32.3,longitude:35.3}],save:async input=>writes.push(input),onClose(){}}));});
  await act(async()=>renderer.root.findAllByType('input').find(n=>n.props['aria-label']==='الوجهة').props.onChange({target:{value:'المكتب'}}));
  await act(async()=>renderer.root.findAllByType('button').find(n=>n.children.join('')==='موقع المكتب · عنوان المكتب').props.onClick());await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes[0].pickup,undefined);assert.equal(writes[0].version,4);assert.equal(writes[0].destination.latitude,32.3);assert.equal(writes[0].destination.longitude,35.3);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();}
});

test('office management adds, edits and deactivates stored places through real API methods',async()=>{
 const hooks=receptionRenderHooks();const writes=[];let rows=[];let renderer;
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.officePlacesApi;',shortCircuit:true};return next(s,c);}});
 globalThis.officePlacesApi={administration:async(path,method='GET',body)=>{if(method==='GET')return rows;writes.push({path,method,body});rows=[{...body,id:'11111111-1111-4111-8111-111111111111',version:(body.version??0)+1}];return rows[0];}};
 const button=text=>renderer.root.findAllByType('button').find(b=>b.children.join('')===text);
 try{
  const {OfficeSuggestedPlaces}=await import('../src/components/office-suggested-places.tsx');await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeSuggestedPlaces));});
  await act(async()=>button('إضافة موقع').props.onClick());
  for(const [index,value] of [[0,'موقع المكتب'],[1,'عنوان المكتب'],[4,'32.2'],[5,'35.2']])await act(async()=>renderer.root.findByType('form').findAllByType('input')[index].props.onChange({target:{value}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes[0].method,'POST');assert.equal(writes[0].body.latitude,32.2);assert.equal(writes[0].body.isActive,true);
  await act(async()=>button('تعديل').props.onClick());await act(async()=>renderer.root.findByType('form').findAllByType('input')[0].props.onChange({target:{value:'الموقع المعدل'}}));await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes[1].method,'PUT');assert.equal(writes[1].body.name,'الموقع المعدل');
  await act(async()=>button('تعطيل').props.onClick());assert.equal(writes[2].method,'PUT');assert.equal(writes[2].body.isActive,false);
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.officePlacesApi;}
});
