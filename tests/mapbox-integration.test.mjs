import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createExpression,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const hooks=receptionRenderHooks();
const {mapboxEnabled,mapboxPublicToken,prepareMapboxStyle,mapboxResourceOrigin}=await import('../src/lib/mapbox-style.ts');
const {mapProvider,mapBlockedReason,arabicHybridStyle,composeMapStyle}=await import('../src/lib/map-provider.ts');
const fixture={version:8,sources:{composite:{type:'vector',url:'mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2'}},layers:[{id:'land',type:'background'},{id:'road',type:'line',source:'composite','source-layer':'road'},{id:'place',type:'symbol',source:'composite','source-layer':'place_label',minzoom:6,maxzoom:18,filter:['has','name'],layout:{'text-field':['get','name'],'text-size':14}},{id:'ref',type:'symbol',source:'composite','source-layer':'road',layout:{'text-field':['get','ref']}}]};
const fields=['NEXT_PUBLIC_MAPBOX_ENABLED','NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN'];
function config(fn){const before=fields.map(n=>process.env[n]);try{return fn();}finally{fields.forEach((n,i)=>before[i]===undefined?delete process.env[n]:process.env[n]=before[i]);}}
test('local resource fixtures are restricted to loopback development and ignored in production',()=>{
 const names=['NODE_ENV','NEXT_PUBLIC_MAPBOX_RESOURCE_ORIGIN'],before=names.map(n=>process.env[n]);
 try{
  process.env.NEXT_PUBLIC_MAPBOX_RESOURCE_ORIGIN='http://127.0.0.1:19430/__qa_mapbox';process.env.NODE_ENV='development';assert.equal(mapboxResourceOrigin(),'http://127.0.0.1:19430/__qa_mapbox');
  process.env.NODE_ENV='production';assert.equal(mapboxResourceOrigin(),'https://api.mapbox.com');
  process.env.NODE_ENV='development';for(const value of ['https://other.invalid/__qa_mapbox','http://127.0.0.1:19430/__qa_mapbox?bad=1','http://user@127.0.0.1/__qa_mapbox']){process.env.NEXT_PUBLIC_MAPBOX_RESOURCE_ORIGIN=value;assert.equal(mapboxResourceOrigin(),'https://api.mapbox.com');}
  process.env.NEXT_PUBLIC_MAPBOX_RESOURCE_ORIGIN='/__qa_mapbox';assert.equal(mapboxResourceOrigin(),'/__qa_mapbox');
  process.env.NODE_ENV='production';assert.equal(mapboxResourceOrigin(),'https://api.mapbox.com');
  process.env.NODE_ENV='development';for(const value of ['//other.invalid/__qa_mapbox','/__qa_mapbox?redirect=1','/__qa_mapbox/../api','/__qa_mapbox/']){process.env.NEXT_PUBLIC_MAPBOX_RESOURCE_ORIGIN=value;assert.equal(mapboxResourceOrigin(),'https://api.mapbox.com');}
 }finally{names.forEach((n,i)=>before[i]===undefined?delete process.env[n]:process.env[n]=before[i]);}
});
test('public token alone never activates Mapbox; secret tokens cannot enable it',()=>config(()=>{
 delete process.env.NEXT_PUBLIC_MAPBOX_ENABLED;process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN='pk.fixture.signature';assert.equal(mapboxEnabled(),false);assert.ok(mapProvider('street').sources.osm);
 process.env.NEXT_PUBLIC_MAPBOX_ENABLED='true';process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN='sk.fixture.signature';assert.equal(mapboxPublicToken(),null);assert.equal(mapProvider('street'),null);assert.ok(mapBlockedReason('satellite'));
}));
test('official resource normalization and satellite switching preserve sources, zoom filters and credits',()=>config(()=>{
 process.env.NEXT_PUBLIC_MAPBOX_ENABLED='true';process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN='pk.fixture.signature';
 const base=prepareMapboxStyle(fixture),street=composeMapStyle(base,'street'),satellite=composeMapStyle(base,'satellite'),hidden=composeMapStyle(base,'satellite',{labels:false});
 assert.equal(mapProvider('street'),mapProvider('satellite'));assert.equal(new URL(mapProvider('street')).pathname,'/styles/v1/mapbox/streets-v12');
 assert.deepEqual(street.sources,satellite.sources);assert.equal(satellite.layers[0].layout.visibility,'visible');assert.equal(street.layers[0].layout.visibility,'none');assert.equal(satellite.layers.find(l=>l.id==='road').layout.visibility,'none');assert.equal(satellite.layers.find(l=>l.id==='place').layout.visibility,'visible');assert.equal(hidden.layers.find(l=>l.id==='place').layout.visibility,'none');
 for(const style of [street,satellite,hidden])assert.deepEqual(validateStyleMin(style),[]);
 const place=satellite.layers.find(l=>l.id==='place');assert.equal(place.minzoom,6);assert.equal(place.maxzoom,18);assert.deepEqual(place.filter,['has','name']);assert.equal(place.layout['text-size'],14);
 assert.match(satellite.sources.composite.tiles[0],/^https:\/\/api\.mapbox\.com\/v4\//);assert.match(satellite.sources.composite.attribution,/Mapbox.*OpenStreetMap.*Improve this map/);assert.match(satellite.sources['dispatch-mapbox-satellite'].attribution,/Maxar/);assert.equal(satellite.layers[0].paint['raster-resampling'],'linear');
 assert.throws(()=>prepareMapboxStyle({...fixture,sources:{bad:{type:'vector',url:'https://other.invalid/tiles'}}}));
}));
test('Arabic labels use nonempty recorded names and leave road references intact',()=>{
 const style=arabicHybridStyle(fixture),expr=createExpression(style.layers[2].layout['text-field']);assert.equal(expr.result,'success');
 for(const [properties,name] of [[{name_ar:'نابلس',name:'Nablus'},'نابلس'],[{name_ar:'','name:ar':'روجيب'},'روجيب'],[{name_ar:'',name:'دير الحطب',name_en:'Deir al-Hatab'},'دير الحطب'],[{name:'',name_en:'QA street'},'QA street'],[{},'']])assert.equal(expr.value.evaluate({zoom:14},{properties}),name);
 assert.deepEqual(style.layers[3],fixture.layers[3]);assert.deepEqual(fixture.layers[2].layout['text-field'],['get','name']);
});
test('Mapbox toggles share one pending style and cached resources; payment/usage failures do not auto-retry',async()=>{
 const before=fields.map(n=>process.env[n]),fetchBefore=globalThis.fetch;let view,requests=0,finish;
 process.env.NEXT_PUBLIC_MAPBOX_ENABLED='true';process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN='pk.pending.fixture';globalThis.fetch=()=>{requests++;return new Promise(resolve=>finish=resolve);};
 try{
  const {useMapStyle}=await import('../src/hooks/use-map-style.ts');const Harness=({kind})=>React.createElement('state',useMapStyle(kind));
  await act(async()=>{view=TestRenderer.create(React.createElement(Harness,{kind:'street'}));});await act(async()=>view.update(React.createElement(Harness,{kind:'satellite'})));assert.equal(requests,1);
  await act(async()=>finish({ok:true,json:async()=>fixture}));await act(async()=>view.update(React.createElement(Harness,{kind:'street'})));assert.equal(requests,1);assert.equal(view.root.findByType('state').props.loading,false);
  await act(async()=>view.unmount());process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN='pk.limited.fixture';
  await act(async()=>{view=TestRenderer.create(React.createElement(Harness,{kind:'street'}));});assert.equal(requests,2);await act(async()=>finish({ok:false,status:429}));
  assert.match(view.root.findByType('state').props.error,/توقف Mapbox/);assert.equal(view.root.findByType('state').props.rawStyle.sources.composite,undefined);await act(async()=>new Promise(resolve=>setTimeout(resolve,50)));assert.equal(requests,2);
 }finally{await act(async()=>view?.unmount());globalThis.fetch=fetchBefore;fields.forEach((n,i)=>before[i]===undefined?delete process.env[n]:process.env[n]=before[i]);}
});
test.after(()=>hooks.deregister());
