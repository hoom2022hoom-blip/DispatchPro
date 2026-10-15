import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {mockFleetMap} from './helpers/fleet-map.mjs';
test('120 cars use clustered and selected sources, status sprites, valid heading and a selection layer without DOM markers',async()=>{
 const hooks=receptionRenderHooks(),stub=registerHooks({resolve(s,c,next){if(s==='react-map-gl/maplibre')return{url:'data:text/javascript,export const Source="source",Layer="layer";',shortCircuit:true};return next(s,c);}});let view;const previousWindow=globalThis.window;globalThis.window=new EventTarget();globalThis.window.matchMedia=()=>({matches:true});
 try{const {OfficeTaxiLayer}=await import('../src/components/office-taxi-layer.tsx');const now=Date.now();
  const drivers=Array.from({length:120},(_,i)=>({id:String(i),fullName:'Driver '+i,active:true,status:i===3?'Offline':'Available',currentRide:i===1?{status:'Assigned'}:i===2?{status:'InProgress'}:null,locationStatus:i===4?'STALE':'FRESH',location:{longitude:35.25+i/10000,latitude:32.22,accuracy:4,updatedAt:new Date(now-2000).toISOString()},previousLocation:null}));
  const map=mockFleetMap();await act(async()=>{view=TestRenderer.create(React.createElement(OfficeTaxiLayer,{drivers,selected:'2',now,maxAge:120,mapRef:{current:map}}));});
  const sources=view.root.findAllByType('source'),source=sources[0],features=sources.flatMap(x=>[...map.getMap().getSource(x.props.id).features.values()]).sort((a,b)=>Number(a.properties.driverId)-Number(b.properties.driverId));assert.equal(features.length,120);assert.equal(source.props.cluster,true);assert.equal(map.getMap().getSource('office-selected-taxi').features.size,1);assert.ok(view.root.findByProps({id:'office-taxi-cluster-hit'}));
  assert.deepEqual(features.slice(0,5).map(f=>f.properties.icon),['taxi-green','taxi-yellow','taxi-blue','taxi-red','taxi-gray']);
  assert.equal(features[2].properties.selected,true);assert.equal(features[0].properties.heading,0);assert.equal(view.root.findAllByType('button').length,0);
  const layer=view.root.findByProps({id:'office-taxi-cars'});assert.equal(layer.props.layout['icon-rotation-alignment'],'map');assert.equal(layer.props.layout['icon-size'],.9);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
