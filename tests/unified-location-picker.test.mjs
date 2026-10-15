import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {customerMobile} from './helpers/customer-mobile.mjs';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';
const places=[{id:'p',name:'رفيديا',addressText:'مستشفى رفيديا',latitude:32.24,longitude:35.27,isActive:true},{id:'hidden',name:'رفيديا مخفي',isActive:false}];

test('office optional pickup/destination/fare and text/suggestion/map transport',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(c.parentURL?.endsWith('/call-logger-form.tsx')&&s==='./shift-picker')return{url:'data:text/javascript,export const ShiftPicker=()=>null;',shortCircuit:true};return next(s,c);}});let view;const calls=[];
 const api=createApiReceptionBackend(async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('auth/login')?{accessToken:'test'}:{});});await api.login('test','test','test');
 try{
  const {CallLoggerForm}=await import('../src/components/call-logger-form.tsx');const {OfficeOrderDestination}=await import('../src/components/office-order-destination.tsx');
  for(const [text,point] of [['وجهة جديدة',undefined],['رفيديا',{latitude:32.24,longitude:35.27}],['الوجهة على الخريطة',{latitude:32.25,longitude:35.28}],['',undefined]]){
   await act(async()=>{view=TestRenderer.create(React.createElement(CallLoggerForm,{optionalAddress:true,onAddRide:r=>api.saveRide({...r,id:'test'}),onEditRide(){}}));});
   await act(async()=>view.root.findAllByType(OfficeOrderDestination).find(n=>n.props.target!=='pickup').props.onChange(text,point));
   const before=calls.length;await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){},persist(){}}));
   assert.equal(calls.length,before+1);const body=JSON.parse(calls.at(-1).init.body);assert.equal(body.totalFare,null);assert.equal(body.fareMode,undefined);assert.equal(body.pickup.name,'');assert.equal(body.pickup.coords,null);if(text){assert.equal(body.dropoff.name,text);assert.deepEqual(body.dropoff.coords,point?{x:point.latitude,y:point.longitude}:undefined);}else assert.equal(body.dropoff,undefined);
   await act(async()=>view.unmount());view=null;
  }
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();}
});

test('one input filters Arabic only and street never requests GPS for suggested pickup; edited text clears coordinates',async()=>{
 const hooks=receptionRenderHooks();let view;const writes=[];let gpsCalls=0;const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(){gpsCalls++;}}}});
 try{
  const {DriverStreetRideForm}=await import('../src/components/driver-street-ride-form.tsx');const {SuggestedPlaceSearch,matchesSuggestedPlace}=await import('../src/components/suggested-place-search.tsx');
  assert.ok(matchesSuggestedPlace(places[0],'رف'));assert.equal(matchesSuggestedPlace(places[0],'hospital'),false);
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverStreetRideForm,{places:async()=>places,sendLocation:async()=>{},save:async r=>writes.push(r),onClose(){}}));});
  const picker=target=>view.root.findAllByType(SuggestedPlaceSearch).find(n=>n.props.target===target);
  assert.equal(view.root.findAllByType('input').length,2);
  await act(async()=>picker('pickup').findByType('input').props.onChange({target:{value:'رف'}}));
  assert.equal(picker('pickup').findAllByType('button').length,1);
  await act(async()=>picker('pickup').findByType('button').props.onClick());
  await act(async()=>picker('destination').props.onSelect(places[0]));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes[0].pickup.latitude,32.24);assert.equal(writes[0].destination.latitude,32.24);
  await act(async()=>picker('destination').props.onChange('وجهة غير موجودة'));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes[1].destination.latitude,undefined);assert.equal(writes[1].destinationPlaceId,undefined);
  await act(async()=>picker('pickup').props.onChange('عنوان آخر'));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes.length,2);assert.match(JSON.stringify(view.toJSON()),/يرجى تحديد موقع الانطلاق/);assert.equal(gpsCalls,0);
 }finally{await act(async()=>view?.unmount());hooks.deregister();if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('customer unified fields filter locally, clear old coordinates and submit manual destination',async()=>{
 const app=await customerMobile({places:{suggestedPlaces:places,savedPlaces:[],recentDestinations:[]}});
 try{
  const pickup=app.nodes.get('pickup-query'),destination=app.nodes.get('destination-query');const before=app.calls.length;
  assert.equal(pickup,app.nodes.get('ride-form').elements.pickup);assert.equal(destination,app.nodes.get('ride-form').elements.destination);
  pickup.value='رف';pickup.oninput();assert.equal(app.nodes.get('pickup-results').children.length,1);app.nodes.get('pickup-results').children[0].onclick();
  destination.value='رف';destination.oninput();app.nodes.get('destination-results').children[0].children[1].onclick();assert.equal(app.context.hooks.state().destinationGps.latitude,32.24);
  destination.onclick();const selectedText=destination.value;app.nodes.get('close-destination-suggestions').onclick();assert.equal(destination.value,selectedText);assert.equal(app.context.hooks.state().destinationGps.latitude,32.24);assert.equal(app.nodes.get('destination-results').children.length,0);
  destination.value='وجهة نصية جديدة';destination.oninput();assert.equal(app.context.hooks.state().destinationGps,null);assert.equal(app.calls.length,before);
  await app.submit('ride-form');await app.nodes.get('confirm-ride').onclick();await app.flush();const body=JSON.parse(app.calls.find(c=>c.url.endsWith('/rides')&&c.init.method==='POST').init.body);assert.equal(body.pickup.latitude,32.24);assert.equal(body.destination,'وجهة نصية جديدة');assert.equal(body.destinationLocation,null);
  pickup.value='عنوان جديد';pickup.oninput();assert.equal(app.context.hooks.state().gps,null);
 }finally{app.context.hooks.lock();}
});

test('destination close and Escape preserve text/coordinates and leave the enclosing form open',async()=>{
 const hooks=receptionRenderHooks();let view;const changes=[],selections=[];
 try{
  const {SuggestedPlaceSearch}=await import('../src/components/suggested-place-search.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement('form',null,React.createElement(SuggestedPlaceSearch,{items:places,target:'destination',value:'رفيديا',onChange:t=>changes.push(t),onSelect:p=>selections.push(p)})));});
  await act(async()=>view.root.findByType('input').props.onFocus());
  const close=view.root.findAllByType('button').find(b=>b.props['aria-label']==='إغلاق اقتراحات الوجهة');assert.equal(close.props.type,'button');
  await act(async()=>close.props.onClick({stopPropagation(){}}));assert.equal(view.root.findAllByType('button').length,0);assert.equal(view.root.findByType('input').props.value,'رفيديا');assert.equal(view.root.findAllByType('form').length,1);assert.deepEqual(changes,[]);assert.deepEqual(selections,[]);
  await act(async()=>view.root.findByType('input').props.onFocus());let stopped=false;await act(async()=>view.root.findAllByType('div').find(n=>n.props.onKeyDown).props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){stopped=true;}}));assert.ok(stopped);assert.equal(view.root.findAllByType('button').length,0);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});
