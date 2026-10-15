import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('ride chat retries exactly the pending message, renders escaped text and never claims delivery/read',async()=>{
 const hooks=receptionRenderHooks();globalThis.window=new EventTarget();let renderer,fail=true;const sends=[];
 try{const {RideChat}=await import('../src/components/ride-chat.tsx');const request=async(path,method='GET',body,signal)=>{if(method==='POST'){sends.push(body);if(fail)throw Error('isolated offline fixture');return {...body,mine:true,createdAt:new Date().toISOString()};}if(path.includes('wait=true'))return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));return {items:[],nextBefore:null};};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(RideChat,{rideId:'private-test-ride',request}));});
 await act(async()=>renderer.root.findAllByType('button')[0].props.onClick());
 await act(async()=>renderer.root.findByType('textarea').props.onChange({target:{value:'<script>مرحبا</script>'}}));
 await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(sends.length,1);assert.match(JSON.stringify(renderer.toJSON()),/بانتظار/);
 fail=false;await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,20));});assert.equal(sends.length,2);assert.equal(sends[0].id,sends[1].id);assert.equal(sends[0].text,sends[1].text);
 const visible=JSON.stringify(renderer.toJSON());assert.doesNotMatch(visible,/private-test-ride|تمت القراءة|تم الوصول/);assert.match(visible,/تم الإرسال/);assert.match(visible,/<script>مرحبا/);
 }finally{if(renderer)await act(async()=>renderer.unmount());hooks.deregister();delete globalThis.window;}
});
