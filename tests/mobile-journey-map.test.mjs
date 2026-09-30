import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Shared MapLibre view reuses map and markers, removes stale driver and keeps manual viewport',async()=>{
  let created=0,fits=0,removed=0;
  const markers=[];
  class MapMock{constructor(){created++;}addControl(){}once(_event,fn){fn();}fitBounds(){fits++;}on(){}}
  class Marker{constructor({element}){this.element=element;markers.push(this);}setLngLat(point){this.point=point;return this;}getLngLat(){return this.point;}addTo(){return this;}remove(){removed++;}}
  globalThis.window={maplibregl:{Map:MapMock,Marker,NavigationControl:class{},LngLatBounds:class{extend(){}}}};
  globalThis.document={createElement:()=>({style:{},setAttribute(){}}),head:{append(node){node.onload?.();}}};
  try{
    const {createJourneyMap}=await import('../public/customer-mobile/maps.js');
    const pickup={latitude:32.22,longitude:35.25},destination={latitude:32.23,longitude:35.27};
    const view=await createJourneyMap({}, {customer:pickup,pickup,destination,driver:pickup});
    assert.equal(created,1);assert.equal(markers.length,4);
    assert.deepEqual(markers.map(m=>m.element.textContent),['● أنت','🚕 السيارة','● الالتقاء','⚑ الوجهة']);
    const fitCount=fits;
    view.update({customer:pickup,pickup,destination,driver:{...pickup,longitude:35.26}});
    assert.equal(created,1);assert.equal(markers.length,4);assert.equal(fits,fitCount);
    assert.deepEqual(markers[1].point,[35.26,32.22]);
    view.update({customer:pickup,pickup,destination});assert.equal(removed,1);
    view.fit();assert.equal(fits,fitCount+1);
  }finally{delete globalThis.window;delete globalThis.document;}
});

test('Driver PWA permits existing OSM tiles and MapLibre workers and builds map styles/assets',()=>{
  const html=readFileSync('driver-mobile/index.html','utf8');
  assert.match(html,/worker-src 'self' blob:/);
  assert.match(html,/connect-src 'self' https:\/\/tile.openstreetmap.org/);
  const build=readFileSync('driver-mobile/build.mjs','utf8');
  assert.match(build,/driver-journey-map.tsx/);assert.match(build,/'maps.js','maplibre-gl.js','maplibre-gl.css'/);
});
