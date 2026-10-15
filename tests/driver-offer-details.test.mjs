import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {normalizeDriverRide} from '../src/lib/driver-payload.js';
import {driverConnectionLabel} from '../src/lib/driver-ui-status.ts';

test('offer shows authorized data, missing fields, zero fare and server-relative expiry without exposing contact details',async()=>{
 const hooks=receptionRenderHooks();
 try{
  const {DriverOfferDetails}=await import('../src/components/driver-offer-details.tsx');
  const now=Date.parse('2026-10-12T15:00:00Z');
  const render=ride=>renderToStaticMarkup(React.createElement(DriverOfferDetails,{ride,now}));
  const ride={id:'fixture-only',status:'Assigned',version:1,pickup:'موقع اختبار',destination:'وجهة اختبار',phone:'DO_NOT_DISPLAY',addressText:'HIDDEN_ADDRESS',notes:'HIDDEN_NOTE'};
  const missing=render(ride);assert.match(missing,/الاسم غير متاح قبل القبول/);assert.match(missing,/السعر لم يحدد بعد/);assert.match(missing,/غير متوفر/);assert.doesNotMatch(missing,/DO_NOT_DISPLAY|HIDDEN_ADDRESS|HIDDEN_NOTE|NaN/);
  const complete=render({...ride,fullName:'زبون اختبار',finalFare:0,offerDistanceMeters:1500,offerEtaSeconds:125,offerExpiresAt:'2026-10-12T18:00:30+03:00'});
  for(const value of ['زبون اختبار','0 ₪','1.5 كم','3 دقيقة','30 ثانية'])assert.ok(complete.includes(value),value);
  assert.match(render({...ride,offerExpiresAt:'2026-10-12T14:59:59Z'}),/انتهت المهلة/);
  assert.doesNotMatch(render({...ride,offerExpiresAt:'invalid'}),/NaN|role="timer"/);
  assert.match(render({...ride,estimatedPrice:12}),/تقديري: 12 ₪/);
 }finally{hooks.deregister();}
});

test('optional ETA and estimate reject invalid numbers and do not fabricate missing customer fields',()=>{
 const base={id:'fixture',status:'Assigned',version:1};
 for(const value of [-1,Infinity,NaN,'120']){
  const ride=normalizeDriverRide({...base,offerEtaSeconds:value,estimatedPrice:value,offerDistanceMeters:value});
  assert.equal(ride.offerEtaSeconds,null);assert.equal(ride.estimatedPrice,null);assert.equal(ride.offerDistanceMeters,null);
  assert.equal(ride.fullName,undefined);assert.equal(ride.phone,undefined);
 }
 assert.equal(normalizeDriverRide({...base,offerEtaSeconds:0}).offerEtaSeconds,0);
});

test('connectivity distinguishes server recovery from an unavailable internet connection',()=>{
 assert.equal(driverConnectionLabel(false,true),'جارٍ إعادة الاتصال بالمكتب');
 assert.equal(driverConnectionLabel(false,false),'انقطع الإنترنت');
 assert.equal(driverConnectionLabel(true,true),'متصل بالمكتب');
 assert.equal(driverConnectionLabel(true,false),'انقطع الإنترنت');
});
