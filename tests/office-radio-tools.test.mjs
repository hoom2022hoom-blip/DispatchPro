import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {savedRadioPosition,radioToolBounds,radioToolPoint,radioToolPosition} from '../src/lib/radio-tool-position.ts';
test('radio defaults to bottom left and saved positions remain inside map after resize',()=>{
 for(const [width,height] of [[1200,700],[375,520],[320,320]]){
 const b=radioToolBounds(width,height,Math.min(288,width-88),250),p=radioToolPoint(null,b);assert.ok(p.left>=12);assert.equal(p.top,b.bottom);
 const moved=radioToolPosition(9999,-999,b);assert.deepEqual(moved,{x:1,y:0});const point=radioToolPoint(moved,b);assert.equal(point.left,b.right);assert.equal(point.top,b.top);
 }assert.equal(savedRadioPosition('{'),null);assert.equal(savedRadioPosition('{"x":"1","y":1}'),null);assert.deepEqual(savedRadioPosition('{"x":3,"y":-1}'),{x:1,y:0});
});
test('short map keeps left toolbar clear without losing normalized drag bounds',()=>{
 const short=radioToolBounds(320,320,232,296);assert.equal(radioToolPoint(null,short).left,64);
 const tall=radioToolBounds(1200,800,288,358);assert.equal(radioToolPoint(null,tall).left,12);assert.equal(tall.top,240);
});
test('office map buttons preserve explicit private recipient and backend speaker selection',async()=>{
 const hooks=receptionRenderHooks();let view;const selected=[],calls=[];
 try{const {OfficeRadioTools}=await import('../src/components/office-radio-tools.tsx');const driver={id:'d',fullName:'أحمد',voice:{voiceEnabled:true,canListen:true}},status={connected:true,talking:null,state:{self:{id:'o',office:true},peers:[{driverId:'d'}],floors:[],lastPublicSpeaker:{driverId:'d',name:'أحمد',startedAt:new Date().toISOString()}}};
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeRadioTools,{client:{start:(...x)=>calls.push(x),stop(){},unlock(){}},status,drivers:[driver],selected:null,onSelect:d=>selected.push(d.id),now:Date.now()}));});
 const buttons=view.root.findAllByType('button'),last=buttons.find(b=>b.props['aria-label']==='آخر سائق تحدث');await act(async()=>last.props.onClick());assert.deepEqual(selected,['d']);
 const privatePtt=buttons.find(b=>b.props['aria-label']?.startsWith('خاص مع'));await act(async()=>privatePtt.props.onPointerDown({button:0,pointerId:3,preventDefault(){},currentTarget:{setPointerCapture(){}}}));assert.deepEqual(calls.at(-1),['private','d']);
 const handle=buttons.find(b=>b.props['aria-label']==='تحريك أدوات المخشير');assert.ok(handle);assert.ok(buttons.some(b=>b.props['aria-label']==='إعادة الموضع الافتراضي'));
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});
