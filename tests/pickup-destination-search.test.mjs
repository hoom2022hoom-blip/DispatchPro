import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('customer searches pickup and destination independently and uses real suggested pickup without GPS',async()=>{
 const place={id:'real-place',label:'دوار الشهداء',addressText:'ساحة الشهداء',latitude:32.22,longitude:35.25};
 const app=await customerMobile({places:{suggestedPlaces:[place],savedPlaces:[],recentDestinations:[]}});
 try{
  const query=app.nodes.get('pickup-query');query.value='ساحة';query.oninput();
  assert.equal(app.nodes.get('pickup-results').children.length,1);
  app.nodes.get('pickup-results').children[0].onclick();
  assert.equal(app.context.hooks.state().gps.latitude,32.22);
  app.nodes.get('open-destination').onclick();
  const destQuery=app.nodes.get('destination-query');destQuery.value='شهد';destQuery.oninput();
  assert.equal(app.nodes.get('destination-results').children[0].children.length,2);
  assert.equal(query.value,place.addressText);
  destQuery.value='جامعة النجاح';destQuery.oninput();app.nodes.get('use-destination-text').onclick();
  assert.equal(app.context.hooks.state().destinationGps,null);
  await app.submit('ride-form');app.nodes.get('confirm-ride').onclick();await app.flush();
  const body=JSON.parse(app.calls.find(c=>c.url==='/api/customer/rides'&&c.init.method==='POST').init.body);
  assert.equal(body.pickup.latitude,32.22);assert.equal(body.destination,'جامعة النجاح');assert.equal(body.destinationLocation,null);
 }finally{app.context.hooks.lock();}
});

test('independent Arabic name and address searches, GPS-off street pickup and text destination',async()=>{
 const hooks=receptionRenderHooks();let view;const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');let gpsResult;let gpsCalls=0;const writes=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(success){gpsCalls++;gpsResult=success;}}}});
 try{
  const {DriverStreetRideForm}=await import('../src/components/driver-street-ride-form.tsx');
  const {matchesSuggestedPlace}=await import('../src/components/suggested-place-search.tsx');
  const items=[{id:'pickup',name:'دوار الشهداء',addressText:'ساحة الشهداء',latitude:32.22,longitude:35.25,isActive:true},{id:'destination',name:'رفيديا',addressText:'المستشفى',latitude:32.24,longitude:35.27,isActive:true}];
  for(const query of ['شهد','ساحة'])assert.equal(matchesSuggestedPlace(items[0],query),true);
  assert.equal(matchesSuggestedPlace(items[0],'SQUARE'),false);
  await act(async()=>{view=TestRenderer.create(React.createElement(DriverStreetRideForm,{places:async()=>items,sendLocation:async()=>({stored:true}),save:async input=>writes.push(input),onClose(){}}));});
  const search=target=>view.root.findAllByType('input').find(n=>n.props['aria-label']===target);
  const option=name=>view.root.findAllByType('button').find(n=>n.children.join('').includes(name));
  await act(async()=>search('موقع الانطلاق').props.onChange({target:{value:'شهد'}}));
  assert.ok(option('دوار الشهداء'));assert.equal(option('رفيديا'),undefined);
  await act(async()=>option('دوار الشهداء').props.onClick());
  await act(async()=>search('الوجهة').props.onChange({target:{value:'مستشفى'}}));
  await act(async()=>option('رفيديا').props.onClick());
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes[0].pickupPlaceId,'pickup');assert.equal(writes[0].destinationPlaceId,'destination');assert.equal(writes[0].pickup.latitude,32.22);
  assert.equal(gpsCalls,0);
  const destination=view.root.findAllByType('input').find(n=>n.props['aria-required']);
  await act(async()=>destination.props.onChange({target:{value:'جامعة النجاح - الحرم الجديد'}}));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes[1].pickup.latitude,32.22);assert.equal(writes[1].destination.latitude,undefined);assert.equal(writes[1].destination.longitude,undefined);assert.equal(writes[1].destinationPlaceId,undefined);
 }finally{await act(async()=>view?.unmount());hooks.deregister();if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
});
