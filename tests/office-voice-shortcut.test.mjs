import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('office setting rejects reserved keys, persists selected key and broadcasts immediate reset',async()=>{
 const hooks=receptionRenderHooks();const stubs=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.shortcutTestApi;',shortCircuit:true};return next(s,c);}});
 const previous=globalThis.window;globalThis.window=new EventTarget();let stored='F2';const saved=[];globalThis.shortcutTestApi={administration:async(path,method='GET',body)=>{assert.equal(path,'voice/shortcut');if(method==='PUT'){stored=body.code;saved.push(body.code);}return{code:stored};}};let view;
 try{const {OfficeVoiceShortcutSettings,useOfficeVoiceShortcut}=await import('../src/components/office-voice-shortcut.tsx');function Readout(){return React.createElement('output',null,useOfficeVoiceShortcut());}
 await act(async()=>{view=TestRenderer.create(React.createElement(React.Fragment,null,React.createElement(OfficeVoiceShortcutSettings),React.createElement(Readout)));});assert.equal(view.root.findByType('output').children[0],'F2');
 const button=text=>view.root.findAllByType('button').find(n=>n.children.join('')===text);
 const key=(type,code,other={})=>{const e=new Event(type,{cancelable:true});for(const [name,value] of Object.entries({code,key:code,...other}))Object.defineProperty(e,name,{value});window.dispatchEvent(e);};
 await act(async()=>button('تغيير').props.onClick());await act(async()=>key('keydown','F5'));assert.equal(saved.length,0);assert.ok(view.root.findAllByProps({role:'alert'}).length);
 await act(async()=>key('keydown','F3'));assert.equal(stored,'F3');assert.equal(view.root.findByType('output').children[0],'F3');
 await act(async()=>button('إعادة الافتراضي').props.onClick());assert.equal(stored,'F1');assert.equal(view.root.findByType('output').children[0],'F1');
 await act(async()=>button('تغيير').props.onClick());await act(async()=>key('keydown','ControlLeft',{ctrlKey:true}));assert.equal(saved.at(-1),'F1');await act(async()=>key('keydown','KeyW',{ctrlKey:true}));await act(async()=>key('keyup','ControlLeft'));assert.equal(stored,'F1');
 await act(async()=>key('keydown','AltLeft',{altKey:true}));await act(async()=>key('keyup','AltLeft'));assert.equal(stored,'AltLeft');
 }finally{await act(async()=>view?.unmount());stubs.deregister();hooks.deregister();globalThis.window=previous;delete globalThis.shortcutTestApi;}
});
