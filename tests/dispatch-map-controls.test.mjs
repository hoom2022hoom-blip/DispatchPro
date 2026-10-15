import {mockFleetMap,sourceData} from './helpers/fleet-map.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('map fullscreen, panel, resize, map controls and manual pan pause driver follow',async()=>{
 const hooks=receptionRenderHooks();
 const stub=registerHooks({resolve(s,c,next){if(s==='next/link')return{url:'data:text/javascript,export default "a";',shortCircuit:true};if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.mapControlsApi;',shortCircuit:true};if(s==='maplibre-gl/dist/maplibre-gl.css')return{url:'data:text/javascript,export {};',shortCircuit:true};if(s==='react-map-gl/maplibre')return{url:'data:text/javascript,'+encodeURIComponent('export default "driver-map";export const AttributionControl="attribution",Marker="marker",Popup="popup",NavigationControl="nav",Source="source",Layer="layer";'),shortCircuit:true};return next(s,c);}});
 const originalWindow=globalThis.window,originalObserver=globalThis.ResizeObserver;globalThis.window=new EventTarget();let resizeCallback;
 globalThis.ResizeObserver=class{constructor(fn){resizeCallback=fn;}observe(){}disconnect(){}};
 const satellite=process.env.NEXT_PUBLIC_MAPTILER_KEY;delete process.env.NEXT_PUBLIC_MAPTILER_KEY;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({version:8,sources:{fixture:{type:'raster',tiles:['https://example.invalid/test-only/{z}/{x}/{y}.png'],tileSize:256}},layers:[{id:'fixture',type:'raster',source:'fixture'}]})});
 let view,resize=0,zoom=0;const moves=[];const at=new Date().toISOString();
 globalThis.mapControlsApi={driverMap:async()=>({serverTime:at,locationMaxAgeSeconds:120,drivers:[{id:'d',active:true,fullName:'Vehicle',status:'Available',waitingCount:2,currentRide:null,locationStatus:'READY',updatedAt:at,location:{latitude:32,longitude:35,accuracy:5,updatedAt:at}}]})};
 try{
  const{OfficeDriverMap}=await import('../src/components/office-driver-map.tsx');await act(async()=>{view=TestRenderer.create(React.createElement(OfficeDriverMap),{createNodeMock:e=>e.type==='driver-map'?mockFleetMap({resize(){resize++;},zoomIn(){zoom++;},zoomOut(){zoom--;},flyTo(value){moves.push(value);},easeTo(value){moves.push(value);}}):{}});});
  const button=text=>view.root.findAllByType('button').find(b=>b.children.join('')===text);
  await act(async()=>view.root.findByProps({'aria-label':'ملء الشاشة'}).props.onClick());assert.match(view.root.findAllByType('section')[0].props.className,/fixed inset-0/);
  assert.doesNotMatch(view.root.findAllByType('section')[0].props.className,/\brelative\b/);
  await act(async()=>view.root.findByProps({'aria-label':'تكبير الخريطة'}).props.onClick());assert.equal(zoom,1);
  await act(async()=>view.root.findByProps({'aria-label':'تصغير الخريطة'}).props.onClick());assert.equal(zoom,0);
  const before=resize;await act(async()=>resizeCallback());assert.ok(resize>before);
  await act(async()=>view.root.findByProps({'aria-label':'قائمة السائقين'}).props.onClick());assert.equal(view.root.findAllByProps({'aria-label':'لوحة السائقين'}).length,1);
  await act(async()=>view.root.findByProps({'aria-label':'طبقات الخريطة'}).props.onClick());
  
  assert.equal(button('MapTiler Satellite').props.disabled,true);assert.equal(view.root.findByType('driver-map').props.mapStyle.sources.osm.type,'raster');
  const marker=view.root.findByProps({id:'office-taxis'}),mapInstance=view.root.findByType('driver-map');
  await act(async()=>view.root.findByType('driver-map').props.onClick({features:[{layer:{id:'office-taxi-cars'},properties:{driverId:'d'}}]}));
  if(view.root.findByProps({'aria-label':'طبقات الخريطة'}).props['aria-expanded'])await act(async()=>view.root.findByProps({'aria-label':'طبقات الخريطة'}).props.onClick());await act(async()=>button('متابعة السيارة').props.onClick());
  const popup=view.root.findByProps({'aria-label':'معلومات السائق المحدد'});
  assert.equal(view.root.findByType('driver-map'),mapInstance);assert.equal(view.root.findByProps({id:'office-taxis'}),marker);
  assert.equal(view.root.findByProps({'aria-label':'معلومات السائق المحدد'}),popup);
  await act(async()=>view.root.findByType('driver-map').props.onClick({features:[{layer:{id:'office-taxi-cars'},properties:{driverId:'d'}}]}));assert.deepEqual(moves.at(-1).center,[35,32]);
  await act(async()=>button('متابعة السيارة').props.onClick());assert.equal(button('إيقاف المتابعة').props['aria-pressed'],true);
  await act(async()=>view.root.findByType('driver-map').props.onDragStart());assert.ok(button('استئناف المتابعة'));
  await act(async()=>button('استئناف المتابعة').props.onClick());assert.ok(button('إيقاف المتابعة'));
  const escape=new Event('keydown');Object.defineProperty(escape,'key',{value:'Escape'});await act(async()=>window.dispatchEvent(escape));assert.doesNotMatch(view.root.findAllByType('section')[0].props.className,/fixed inset-0/);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete process.env.NEXT_PUBLIC_MAP_IMAGERY_APPROVED;delete process.env.NEXT_PUBLIC_MAP_IMAGERY_URL;delete process.env.NEXT_PUBLIC_MAP_IMAGERY_ATTRIBUTION;globalThis.window=originalWindow;globalThis.ResizeObserver=originalObserver;delete globalThis.mapControlsApi;globalThis.fetch=originalFetch;if(satellite)process.env.NEXT_PUBLIC_MAPTILER_KEY=satellite;else delete process.env.NEXT_PUBLIC_MAPTILER_KEY;}
});
