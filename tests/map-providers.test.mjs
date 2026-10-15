import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import {createExpression} from '@maplibre/maplibre-gl-style-spec';
const label=(field,properties)=>{const expression=createExpression(field);assert.equal(expression.result,'success');return expression.value.evaluate({zoom:14},{properties});};
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const providerHooks=receptionRenderHooks();
const {mapProvider,mapBlockedReason,arabicHybridStyle}=await import('../src/lib/map-provider.ts');
providerHooks.deregister();

test('providers require explicit configuration and use only official APIs',()=>{
 const names=['NEXT_PUBLIC_MAPTILER_KEY','NEXT_PUBLIC_COPERNICUS_WMS_INSTANCE_ID','NEXT_PUBLIC_COPERNICUS_SENTINEL2_LAYER'];
 const previous=names.map(n=>process.env[n]);
 try{
  names.forEach(n=>delete process.env[n]);
  assert.ok(mapProvider('street').sources.osm);
  for(const kind of ['satellite','hybrid','sentinel']){assert.equal(mapProvider(kind),null);assert.ok(mapBlockedReason(kind));}
  process.env.NEXT_PUBLIC_MAPTILER_KEY='test-fixture-only & encoded';
  for(const [kind,id] of [['satellite','satellite-v4'],['hybrid','hybrid-v4']]){
   const url=new URL(mapProvider(kind));assert.equal(url.origin,'https://api.maptiler.com');assert.equal(url.pathname,`/maps/${id}/style.json`);assert.equal(url.searchParams.get('key'),process.env.NEXT_PUBLIC_MAPTILER_KEY);
  }
  process.env.NEXT_PUBLIC_COPERNICUS_WMS_INSTANCE_ID='00000000-0000-0000-0000-000000000000';
  assert.equal(mapProvider('sentinel'),null);
  process.env.NEXT_PUBLIC_COPERNICUS_SENTINEL2_LAYER='TEST_SENTINEL2_RGB';
  const style=mapProvider('sentinel'),source=style.sources.sentinel;
  const url=new URL(source.tiles[0]);assert.equal(url.origin,'https://sh.dataspace.copernicus.eu');assert.equal(url.searchParams.get('TIME'),null);assert.equal(url.searchParams.get('LAYERS'),'TEST_SENTINEL2_RGB');assert.equal(source.maxzoom,13);assert.equal(style.layers[0].paint['raster-resampling'],'nearest');
 }finally{names.forEach((n,i)=>previous[i]===undefined?delete process.env[n]:process.env[n]=previous[i]);}
});

test('hybrid retains imagery, road overlays and attribution while preferring supplied Arabic names',()=>{
 const original={version:8,glyphs:'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf',sources:{imagery:{type:'raster',maxzoom:22,attribution:'provider credit'},roads:{type:'vector',attribution:'road credit'}},layers:[{id:'imagery',type:'raster',source:'imagery'},{id:'road',type:'line',source:'roads'},{id:'road-name',type:'symbol',source:'roads',layout:{'text-field':['get','name:en'],'text-size':14}},{id:'route-number',type:'symbol',source:'roads',layout:{'text-field':['get','ref']}}]};
 const result=arabicHybridStyle(original);
 assert.equal(result.sources,original.sources);assert.equal(result.glyphs,original.glyphs);assert.equal(result.layers[0],original.layers[0]);assert.equal(result.layers[1],original.layers[1]);assert.equal(result.layers[3],original.layers[3]);assert.equal(label(result.layers[2].layout['text-field'],{'name:ar':'نابلس',name:'Nablus'}),'نابلس');assert.equal(label(result.layers[2].layout['text-field'],{'name:ar':'',name:'روجيب'}),'روجيب');assert.deepEqual(original.layers[2].layout['text-field'],['get','name:en']);
});

test('only selected styles load and stale responses cannot replace a newer selection',async()=>{
 const hooks=receptionRenderHooks(),previousFetch=globalThis.fetch,previousKey=process.env.NEXT_PUBLIC_MAPTILER_KEY;
 const requests=[];let view;
 process.env.NEXT_PUBLIC_MAPTILER_KEY='test-fixture-only';
 globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,signal:options.signal,resolve}));
 try{
  const {useMapStyle}=await import('../src/hooks/use-map-style.ts');
  function Harness({kind}){return React.createElement('style-state',useMapStyle(kind));}
  await act(async()=>{view=TestRenderer.create(React.createElement(Harness,{kind:'street'}));});
  assert.equal(requests.length,0);
  await act(async()=>view.update(React.createElement(Harness,{kind:'satellite'})));
  assert.equal(requests.length,1);assert.equal(view.root.findByType('style-state').props.loading,true);
  await act(async()=>view.update(React.createElement(Harness,{kind:'hybrid'})));
  assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,false); // Shared pending style remains cacheable; obsolete consumer is detached.
  const fixture={version:8,sources:{},layers:[{id:'place',type:'symbol',layout:{'text-field':['get','name:en']}}]};
  await act(async()=>requests[0].resolve({ok:true,json:async()=>fixture}));
  assert.ok(view.root.findByType('style-state').props.style.sources.osm);
  await act(async()=>requests[1].resolve({ok:true,json:async()=>fixture}));
  assert.equal(label(view.root.findByType('style-state').props.style.layers[0].layout['text-field'],{name_ar:'شارع فيصل',name:'Faisal Street'}),'شارع فيصل');
  await act(async()=>view.update(React.createElement(Harness,{kind:'street'})));
  assert.equal(requests[1].signal.aborted,false);assert.equal(requests.length,2);assert.ok(view.root.findByType('style-state').props.style.sources.osm);await act(async()=>view.update(React.createElement(Harness,{kind:'hybrid'})));assert.equal(requests.length,2); // Cached style is reused.
 }finally{await act(async()=>view?.unmount());hooks.deregister();globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.NEXT_PUBLIC_MAPTILER_KEY;else process.env.NEXT_PUBLIC_MAPTILER_KEY=previousKey;}
});
