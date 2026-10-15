import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

test('optional inline fare saves 18 once, retains errors and cancels edits with Escape',async()=>{
 const hooks=receptionRenderHooks();let view,release,calls=[];let fail=false;
 try{
  const {InlineOfficeFare}=await import('../src/components/inline-office-fare.tsx');
  await act(async()=>{view=TestRenderer.create(React.createElement(InlineOfficeFare,{ride:{id:'r',totalFare:null},onSave:async(r,a)=>{calls.push(a);if(fail)throw Error('API unavailable');await new Promise(resolve=>release=resolve);}}));});
  const input=()=>view.root.findByType('input');
  const key=k=>({key:k,repeat:false,nativeEvent:{isComposing:false},preventDefault(){},stopPropagation(){}});
  await act(async()=>input().props.onKeyDown(key('Enter')));assert.equal(calls.length,0);
  await act(async()=>input().props.onChange({target:{value:'18'}}));
  await act(async()=>{input().props.onKeyDown(key('Enter'));input().props.onKeyDown(key('Enter'));});assert.deepEqual(calls,[18]);
  await act(async()=>release());assert.equal(input().props.value,'18.00');
  fail=true;await act(async()=>input().props.onChange({target:{value:'22'}}));await act(async()=>input().props.onKeyDown(key('Enter')));
  assert.equal(input().props.value,'22');assert.equal(view.root.findByProps({role:'alert'}).children.length>0,true);
  await act(async()=>input().props.onKeyDown(key('Escape')));assert.equal(input().props.value,'18.00');
  await act(async()=>input().props.onChange({target:{value:'-1'}}));await act(async()=>input().props.onKeyDown(key('Enter')));assert.deepEqual(calls,[18,22]);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});
