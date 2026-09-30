import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
test('change-driver picker searches name, local phone and plate and selects the replacement',async()=>{
 const stub=s=>({url:'data:text/javascript,'+encodeURIComponent(s),shortCircuit:true});
 const hook=registerHooks({resolve(s,c,next){if(c.parentURL?.endsWith('/shift-picker.tsx')){
  if(s==='./ui/popover')return stub('export const Popover="div",PopoverContent="section",PopoverTrigger="div";');
  if(s==='./ui/button')return stub('export const Button="button";');
  if(s==='./ui/input')return stub('export const Input="input";');
 }return next(s,c);},load(url,c,next){if(url.endsWith('/shift-picker.tsx'))return{format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
 let renderer;const selected=[];
 try{const {ShiftPicker}=await import('../src/components/shift-picker.tsx');await act(async()=>{renderer=TestRenderer.create(React.createElement(ShiftPicker,{value:'a',changeLabel:'تغيير السائق',onChange:id=>selected.push(id),choices:[{id:'a',label:'أحمد',searchText:'0591111111 OLD-1'},{id:'b',label:'محمد',searchText:'0562222222 NEW-2'}]}));});
  assert.ok(JSON.stringify(renderer.toJSON()).includes('تغيير السائق'));
  for(const query of ['محمد','0562222222','NEW-2']){await act(async()=>renderer.root.findByType('input').props.onChange({target:{value:query}}));const buttons=renderer.root.findByType('section').findAllByType('button');assert.equal(buttons.length,2);assert.ok(buttons[1].children.includes('محمد'));}
  await act(async()=>renderer.root.findByType('section').findAllByType('button')[1].props.onClick());assert.deepEqual(selected,['b']);
 }finally{await act(async()=>renderer?.unmount());hook.deregister();}
});
