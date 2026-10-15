import {mockFleetMap,sourceData} from './helpers/fleet-map.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('TEST 21–36: floating driver search and persistent recorded GPS',async t=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){
  if(s==='next/link')return {url:'data:text/javascript,export default "a";',shortCircuit:true};
  if(s==='@/lib/reception-api')return {url:'data:text/javascript,export const apiReceptionBackend=globalThis.searchMapApi;',shortCircuit:true};
  if(s==='maplibre-gl/dist/maplibre-gl.css')return {url:'data:text/javascript,export {};',shortCircuit:true};
  if(s==='react-map-gl/maplibre')return {url:'data:text/javascript,'+encodeURIComponent('export default "search-map";export const AttributionControl="attribution",Marker="marker",Popup="popup",NavigationControl="nav",Source="source",Layer="layer";'),shortCircuit:true};
  return next(s,c);
 }});
 const originalWindow=globalThis.window,originalTimeout=globalThis.setTimeout;
 globalThis.window=new EventTarget();let poll;
 globalThis.setTimeout=(fn,ms,...args)=>ms===5000?(poll=fn,0):originalTimeout(fn,ms,...args);
 const at=new Date().toISOString();
 const base={active:true,status:'Available',waitingCount:0,currentRide:null,locationStatus:'NO_LOCATION',location:null};
 let data={serverTime:at,locationMaxAgeSeconds:120,drivers:[
  {...base,id:'test',fullName:'Driver Test',phone:'0591234567',locationStatus:'FRESH',location:{latitude:32.22,longitude:35.25,accuracy:8,updatedAt:at}},
  {...base,id:'arabic',fullName:'محمد عمر'},
  ...Array.from({length:285},(_,i)=>({...base,id:'driver-'+i,fullName:'Registered '+String(i).padStart(3,'0'),status:'Offline'}))
 ]};
 let calls=0;const moves=[];let view;
 globalThis.searchMapApi={driverMap:async()=>{calls++;return data;}};
 const click=async label=>act(async()=>view.root.findByProps({'aria-label':label}).props.onClick({stopPropagation(){}}));
 const open=async()=>{if(!view.root.findByProps({'aria-label':'فتح بحث السائقين'}).props['aria-expanded'])await click('فتح بحث السائقين');};
 const search=async value=>act(async()=>view.root.findByProps({'aria-label':'ابحث عن سائق'}).props.onChange({target:{value}}));
 const results=()=>view.root.findAllByType('button').filter(b=>b.props['aria-label']?.startsWith('نتيجة بحث '));
 const text=()=>JSON.stringify(view.toJSON());
 const stale=async()=>{data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,locationStatus:'STALE',location:{...d.location,updatedAt:new Date(Date.parse(at)-12*60000).toISOString()}}:d)};await act(async()=>poll());};
 try{
  const {OfficeDriverMap}=await import('../src/components/office-driver-map.tsx');
  const {mapDriverOffline,matchesMapDriver,locationLabel}=await import('../src/lib/office-driver-map.ts');
  await act(async()=>{view=TestRenderer.create(React.createElement(OfficeDriverMap),{createNodeMock:e=>e.type==='search-map'?mockFleetMap({resize(){},flyTo:value=>moves.push(value)}):{}});});
  await click('قائمة السائقين');
  await t.test('destination poll updates marker and open popup on the same map instance',async()=>{
   data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,currentRide:{id:'active',status:'InProgress',destination:'Original real destination'}}:d)};await act(async()=>poll());await click('اختيار Driver Test');
   const map=view.root.findByType('search-map'),marker=view.root.findByProps({id:'office-taxis'}),popup=view.root.findByProps({'aria-label':'معلومات السائق المحدد'});assert.match(text(),/Original real destination/);
   data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,currentRide:{...d.currentRide,destination:'Updated real destination'}}:d)};await act(async()=>poll());
   assert.equal(view.root.findByType('search-map'),map);assert.equal(view.root.findByProps({id:'office-taxis'}),marker);assert.equal(view.root.findByProps({'aria-label':'معلومات السائق المحدد'}),popup);assert.match(text(),/Updated real destination/);assert.doesNotMatch(text(),/Original real destination/);
   const sidebar=view.root.findByProps({'aria-label':'اختيار Driver Test'}).parent;assert.match(sidebar.findAllByType('span').map(span=>span.children.filter(child=>typeof child==='string').join('')).join(' '),/Updated real destination/);
   data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,currentRide:{...d.currentRide,destination:''}}:d)};await act(async()=>poll());
   assert.match(text(),/الوجهة غير محددة/);
   data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,currentRide:null}:d)};await act(async()=>poll());assert.match(text(),/لا توجد وجهة حالية/);
   assert.doesNotMatch(text(),/الوجهة غير محددة/);
  });
  await t.test('TEST 21: opening search immediately lists registered drivers',async()=>{await open();assert.equal(results().length,25);assert.match(text(),/Driver Test/);});
  await t.test('TEST 22: instant Arabic partial-name filtering',async()=>{await search('محمد');assert.equal(results().length,1);assert.match(text(),/محمد عمر/);});
  await t.test('TEST 23: case-insensitive name, ID and phone search',async()=>{await search('driver TEST');assert.equal(results().length,1);assert.equal(matchesMapDriver(data.drivers[0],'059123'),true);assert.equal(matchesMapDriver(data.drivers[0],'TEST'),true);});
  await t.test('TEST 24: fresh result selects, highlights, flies to real marker',async()=>{await click('نتيجة بحث Driver Test');assert.deepEqual(moves.at(-1).center,[35.25,32.22]);assert.equal(sourceData(view,'office-selected-taxi').features[0].properties.driverId,'test');assert.equal(view.root.findAllByProps({'aria-label':'معلومات السائق المحدد'}).length,1);});
  await t.test('TEST 25: stale result uses last known GPS',async()=>{await stale();await open();await search('Driver Test');await click('نتيجة بحث Driver Test');assert.deepEqual(moves.at(-1).center,[35.25,32.22]);});
  await t.test('TEST 26: no-GPS selection closes search without fake marker or movement',async()=>{await open();await search('محمد');const count=moves.length;await click('نتيجة بحث محمد عمر');assert.equal(moves.length,count);assert.equal(sourceData(view,'office-taxis').features.length,1);assert.equal(results().length,0);assert.match(text(),/لا يوجد موقع مسجل لهذا السائق/);assert.equal(view.root.findAllByProps({'aria-label':'معلومات السائق المحدد'}).length,1);await open();await search('محمد');assert.equal(results().length,1);});
  let marker;
  await t.test('TEST 27: fresh to stale retains the same marker',async()=>{data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,locationStatus:'FRESH',location:{...d.location,updatedAt:at}}:d)};await act(async()=>poll());marker=view.root.findByProps({id:'office-taxis'});await stale();assert.equal(view.root.findByProps({id:'office-taxis'}),marker);});
  await t.test('TEST 28: freshness text changes at 120 seconds',async()=>{await search('Driver Test');assert.match(locationLabel(data.drivers[0],Date.parse(at)),/آخر موقع منذ 12 دقيقة/);assert.equal(mapDriverOffline(data.drivers[0]),false);const d={...data.drivers[0],locationStatus:'FRESH'},time=Date.parse(d.location.updatedAt);assert.equal(locationLabel(d,time+120000),'موقع مباشر');assert.match(locationLabel(d,time+120001),/آخر موقع منذ/);assert.match(locationLabel(d,time+2*3600000),/2 ساعة/);});
  await t.test('TEST 29: new GPS updates same marker and returns live without reload',async()=>{data={...data,drivers:data.drivers.map(d=>d.id==='test'?{...d,locationStatus:'FRESH',location:{...d.location,latitude:32.23,updatedAt:at}}:d)};await act(async()=>poll());assert.equal(view.root.findByProps({id:'office-taxis'}),marker);assert.equal(sourceData(view,'office-taxis').features[0].geometry.coordinates[1],32.23);assert.equal(locationLabel(data.drivers[0],Date.parse(at)),'موقع مباشر');});
  await t.test('TEST 30: a last-known point suppresses the general no-location message',async()=>{await stale();assert.doesNotMatch(text(),/لا يوجد موقع مسجل للسائقين/);});
  await t.test('TEST 31: Target uses last known location',async()=>{await click('قائمة السائقين');await click('اختيار Driver Test');assert.deepEqual(moves.at(-1).center,[35.25,32.23]);});
  await t.test('TEST 32: search result uses last known location',async()=>{await open();await search('Driver Test');await click('نتيجة بحث Driver Test');assert.deepEqual(moves.at(-1).center,[35.25,32.23]);});
  await t.test('TEST 33: search uses only the office-scoped batch response',async()=>{await open();await search('Other Tenant Driver');assert.equal(results().length,0);});
  await t.test('TEST 34: 287 drivers, bounded rows, paging and no per-driver requests',async()=>{await search('');const count=calls;assert.equal(data.drivers.length,287);assert.equal(results().length,25);await click('نتائج البحث التالية');assert.equal(results().length,25);await search('Registered 284');assert.equal(results().length,1);assert.equal(calls,count);});
  await t.test('TEST 35: Escape closes search',async()=>{const e=new Event('keydown');Object.defineProperty(e,'key',{value:'Escape'});await act(async()=>window.dispatchEvent(e));assert.equal(view.root.findAllByProps({id:'driver-map-search'}).length,0);});
  await t.test('TEST 36: selection closes floating search and opens only the small popup',async()=>{await open();await search('Driver Test');await click('نتيجة بحث Driver Test');assert.equal(view.root.findAllByProps({id:'driver-map-search'}).length,0);assert.equal(view.root.findAllByProps({'aria-label':'معلومات السائق المحدد'}).length,1);assert.ok(view.root.findByProps({'aria-label':'معلومات السائق المحدد'}));await open();await click('إغلاق بحث السائقين');assert.equal(view.root.findAllByProps({id:'driver-map-search'}).length,0);});
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();globalThis.window=originalWindow;globalThis.setTimeout=originalTimeout;delete globalThis.searchMapApi;}
});
