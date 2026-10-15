import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Shared MapLibre view reuses map and markers, removes stale driver and keeps manual viewport',async()=>{
  let created=0,fits=0,removed=0;
  const markers=[];
  class MapMock{constructor(){created++;}addControl(){}once(_event,fn){fn();}fitBounds(){fits++;}on(){}}
  class Marker{constructor({element}){this.element=element;markers.push(this);}setLngLat(point){this.point=point;return this;}getLngLat(){return this.point;}addTo(){return this;}remove(){removed++;}}
  const oldCancel=globalThis.cancelAnimationFrame;globalThis.cancelAnimationFrame=()=>{};
  globalThis.window={matchMedia:()=>({matches:true}),maplibregl:{Map:MapMock,Marker,NavigationControl:class{},LngLatBounds:class{extend(){}}}};
  globalThis.document={createElement:()=>({style:{},setAttribute(){}}),head:{append(node){node.onload?.();}}};
  try{
    const {createJourneyMap}=await import('../public/customer-mobile/maps.js');
    const pickup={latitude:32.22,longitude:35.25},destination={latitude:32.23,longitude:35.27};
    const view=await createJourneyMap({}, {customer:pickup,pickup,destination,driver:pickup});
    assert.equal(created,1);assert.equal(markers.length,4);
    assert.deepEqual(markers.map(m=>m.element.textContent),['أنت','السيارة','الالتقاء','الوجهة']);
    const fitCount=fits;
    view.update({customer:pickup,pickup,destination,driver:{...pickup,longitude:35.26}});
    assert.equal(created,1);assert.equal(markers.length,4);assert.equal(fits,fitCount);
    assert.deepEqual(markers[1].point,[35.26,32.22]);
    view.update({customer:pickup,pickup,destination});assert.equal(removed,1);
    view.fit();assert.equal(fits,fitCount+1);
  }finally{delete globalThis.window;delete globalThis.document;if(oldCancel)globalThis.cancelAnimationFrame=oldCancel;else delete globalThis.cancelAnimationFrame;}
});

test('Driver PWA permits existing OSM tiles and MapLibre workers and builds map styles/assets',()=>{
  const html=readFileSync('driver-mobile/index.html','utf8');
  assert.match(html,/worker-src 'self' blob:/);
  assert.match(html,/connect-src 'self' https:\/\/tile.openstreetmap.org/);
  const build=readFileSync('driver-mobile/build.mjs','utf8');
  assert.match(build,/driver-journey-map.tsx/);assert.match(build,/'maps.js','maplibre-gl.js','maplibre-gl.css'/);
});

test('customer picker has no default selected marker and click/drag update one marker without recreating the map',async()=>{
 let constructed=0;const markers=[],chosen=[];let center;
 class MapMock{events={};constructor(options){constructed++;center=options.center;}addControl(){}on(event,fn){this.events[event]=fn;}}
 class Marker{events={};constructor(options){this.options=options;markers.push(this);}setLngLat(p){this.point=p;return this;}getLngLat(){return this.point;}addTo(){return this;}on(event,fn){this.events[event]=fn;}}
 const originalWindow=globalThis.window,originalDocument=globalThis.document;
 globalThis.window={maplibregl:{Map:MapMock,Marker,NavigationControl:class{}}};globalThis.document={createElement:()=>({}),head:{append(node){node.onload?.();}}};
 try{
  const {createMap}=await import('../public/customer-mobile/maps.js?picker-test');
  const picker=await createMap({},null,point=>chosen.push(point));
  assert.deepEqual(center,[35.2544,32.2211]);assert.equal(picker.marker,null);assert.equal(chosen.length,0);assert.equal(markers.length,0);
  picker.map.events.click({lngLat:{lat:32.2,lng:35.2}});assert.equal(markers.length,1);assert.equal(chosen[0].latitude,32.2);assert.equal(picker.marker.options.draggable,true);
  picker.marker.point={lat:32.3,lng:35.3};picker.marker.events.dragend();assert.equal(chosen.at(-1).longitude,35.3);assert.equal(constructed,1);assert.equal(markers.length,1);
 }finally{globalThis.window=originalWindow;globalThis.document=originalDocument;}
});
