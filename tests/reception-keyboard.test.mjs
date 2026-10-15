import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {enterNextField,nextControl,focusableControls,receptionShortcut} from '../src/lib/reception-keyboard.ts';

function keyboard(key,patch={}) {return {key,repeat:false,defaultPrevented:false,nativeEvent:{isComposing:false},preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...patch};}
function formControls() {
 let focused='';const fields=[];
 const root={querySelectorAll:()=>fields,contains:el=>fields.includes(el)};
 for(const name of ['clock','phone','name','address','hidden','driver','save']) fields.push({name,
  matches(selector){return selector.includes(':disabled')?name==='clock':selector.startsWith('input')?['phone','name'].includes(name):false;},
  closest(selector){return selector==='form,tr,[role="dialog"]'?root:selector==='[hidden],[inert]'&&name==='hidden'?{}:null;},
  getAttribute:()=>null,value:'abc',selectionStart:0,selectionEnd:3,getClientRects:()=>[{}],focus(){focused=name;},
 });
 return {fields,root,get focused(){return focused;}};
}

test('native Tab and Shift+Tab remain intact; Enter advances usable fields, preserves textarea and avoids early submit',()=>{
 const f=formControls();const [clock,phone,name,address]=f.fields;
 assert.deepEqual(focusableControls(f.root).map(x=>x.name),['phone','name','address','driver','save']);
 assert.equal(nextControl(phone),name);assert.equal(nextControl(name,true),phone);
 for(const shiftKey of [false,true]){const event=keyboard('Tab',{target:phone,currentTarget:f.root,shiftKey});enterNextField(event);assert.equal(event.defaultPrevented,false);}
 const event=keyboard('Enter',{target:phone,currentTarget:f.root});enterNextField(event);assert.equal(event.defaultPrevented,true);assert.equal(f.focused,'name');
 enterNextField(keyboard('Enter',{target:name,currentTarget:f.root}));assert.equal(f.focused,'address');
 for(const patch of [{target:address},{target:name,repeat:true},{target:name,nativeEvent:{isComposing:true}}]){const event=keyboard('Enter',{currentTarget:f.root,...patch});enterNextField(event);assert.equal(f.focused,'address');}
 assert.equal(receptionShortcut(keyboard('',{altKey:true,code:'KeyN',target:{closest:()=>null}})),'new');
 assert.equal(receptionShortcut(keyboard('',{altKey:true,code:'KeyN',target:{closest:()=>({})}})),null);
});

test('picker arrow search skips offline drivers, Enter selects once, Escape cancels, Tab returns focus',async()=>{
 const hooks=receptionRenderHooks();let renderer,release,closed=0,focused=0;const calls=[];
 const savedDocument=globalThis.document;globalThis.document={getElementById:()=>({scrollIntoView(){}})};
 const next={matches:()=>false,closest:()=>null,getClientRects:()=>[{}],focus(){focused++;}};
 const trigger={...next,closest:selector=>selector==='form,tr,[role="dialog"]'||selector==='td'?root:null};const root={querySelectorAll:()=>[trigger,next],querySelector:()=>trigger};
 try{
  const {ShiftPicker}=await import('../src/components/shift-picker.tsx');
  const props={value:'',initialOpen:true,allowClear:false,onClose:()=>closed++,choices:[{id:'a',label:'متاح',driverGroup:0},{id:'b',label:'محمد',driverGroup:2,waitingCount:2},{id:'c',label:'مغلق',driverGroup:3,disabled:true}],onChange:async id=>{calls.push(id);await new Promise(resolve=>release=resolve);}};
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ShiftPicker,props),{createNodeMock:el=>el.type==='button'?trigger:{focus(){}}});});
  const input=()=>renderer.root.findByType('input');const popup=()=>renderer.root.findByType('section');
  await act(async()=>input().props.onKeyDown(keyboard('ArrowDown')));
  assert.ok(input().props['aria-activedescendant'].endsWith('-b'));
  await act(async()=>input().props.onKeyDown(keyboard('ArrowDown')));
  assert.ok(input().props['aria-activedescendant'].endsWith('-a'));
  await act(async()=>input().props.onKeyDown(keyboard('ArrowUp')));
  assert.ok(input().props['aria-activedescendant'].endsWith('-b'));
  const choose=input().props.onKeyDown;
  await act(async()=>{choose(keyboard('Enter'));choose(keyboard('Enter'));choose(keyboard('Enter',{repeat:true}));});
  assert.deepEqual(calls,['b']);await act(async()=>release());assert.equal(focused,1);
  await act(async()=>popup().props.onEscapeKeyDown(keyboard('Escape')));assert.equal(closed,1);assert.equal(calls.length,1);
  await act(async()=>input().props.onChange({target:{value:'محمد'}}));assert.equal(renderer.root.findAllByProps({role:'option'}).length,1);
  const tab=keyboard('Tab');await act(async()=>input().props.onKeyDown(tab));assert.equal(tab.defaultPrevented,true);assert.equal(closed,2);
  popup().props.onCloseAutoFocus({preventDefault(){}});assert.equal(focused,2);
  const back=keyboard('Tab',{shiftKey:true});await act(async()=>input().props.onKeyDown(back));assert.equal(back.defaultPrevented,true);popup().props.onCloseAutoFocus({preventDefault(){}});assert.equal(focused,3);
 }finally{await act(async()=>renderer?.unmount());hooks.deregister();globalThis.document=savedDocument;}
});

test('keyboard behavior is wired to both forms, focus styles cover portals, and dispatch monitor moved to settings',()=>{
 const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 for(const file of ['call-logger-form','reception-edit-form'])assert.match(source(`src/components/${file}.tsx`),/onKeyDown=\{enterNextField\}/);
 assert.match(source('src/app/globals.css'),/\.reception-picker[\s\S]*focus-visible/);
 assert.match(source('src/app/globals.css'),/outline: 2px solid #2563eb/);
 assert.doesNotMatch(source('src/components/api-reception.tsx'),/<DispatchMonitor/);
 assert.match(source('src/components/office-page.tsx'),/section==='settings'[\s\S]*?<DispatchMonitor/);
 assert.match(source('src/components/api-reception.tsx'),/driversPanel,setDriversPanel.*useState\(false\)/);
});

test('traditional queue supports search arrows, Enter, Escape and prevents repeated mutations',async()=>{
 const hooks=receptionRenderHooks();const {registerHooks}=await import('node:module');
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.keyboardQueueApi;',shortCircuit:true};return next(s,c);}});
 let renderer,release,focused=0;const calls=[];
 globalThis.keyboardQueueApi={driverQueue:async action=>{calls.push(action);await new Promise(r=>release=r);}};
 try{
  const {OfficeQueuePanel}=await import('../src/components/office-queue.tsx');
  const data={drivers:[{id:'a',fullName:'أحمد',active:true,status:'Available'},{id:'b',fullName:'محمد',active:true,status:'Available'}],vehicles:[],reception:{rides:[],queue:[],shifts:[],queueLocations:[{id:'area',name:'الوسط',isActive:true,sortOrder:0}]}};
  const props={data,refresh:async()=>{},embedded:true};
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OfficeQueuePanel,props),{createNodeMock:()=>({focus(){focused++;}})});});
  const input=()=>renderer.root.findByProps({'aria-label':'بحث السائقين للدور'});
  await act(async()=>input().props.onFocus());
  await act(async()=>input().props.onKeyDown(keyboard('ArrowDown')));
  assert.equal(renderer.root.findAllByProps({role:'option'})[1].props['aria-selected'],true);
  await act(async()=>input().props.onKeyDown(keyboard('Enter')));assert.equal(focused,1);
  assert.equal(renderer.root.findAllByProps({role:'listbox'}).length,0);
  const location=renderer.root.findByProps({'aria-label':'موقع السائق'});
  await act(async()=>location.props.onChange({target:{value:'area'}}));
  location.props.onKeyDown(keyboard('Enter',{currentTarget:{nextElementSibling:{focus(){focused++;}}}}));assert.equal(focused,2);
  const add=renderer.root.findAllByType('button').find(b=>b.children.join('')==='إضافة للدور');
  await act(async()=>{add.props.onClick();add.props.onClick();});assert.equal(calls.length,1);assert.equal(calls[0].driverId,'b');
  await act(async()=>release());await act(async()=>input().props.onFocus());
  const escape=keyboard('Escape');await act(async()=>input().props.onKeyDown(escape));assert.equal(escape.defaultPrevented,true);
  assert.equal(renderer.root.findAllByProps({role:'listbox'}).length,0);
  await act(async()=>renderer.update(React.createElement(OfficeQueuePanel,{...props,data:{...data,reception:{...data.reception,queue:[{driverId:'a',position:1},{driverId:'b',position:2}]}}})));
  const rows=renderer.root.findAllByProps({role:'button'});let arrowFocus=-1;
  const targets=[0,1].map(i=>({focus(){arrowFocus=i;}}));
  rows[0].props.onKeyDown(keyboard('ArrowDown',{currentTarget:{parentElement:{querySelectorAll:()=>targets}}}));assert.equal(arrowFocus,1);
  rows[1].props.onKeyDown(keyboard('ArrowUp',{currentTarget:{parentElement:{querySelectorAll:()=>targets}}}));assert.equal(arrowFocus,0);
  await act(async()=>rows[1].props.onKeyDown(keyboard('Enter')));assert.equal(renderer.root.findAllByProps({role:'button'})[1].props['aria-pressed'],true);
 }finally{await act(async()=>renderer?.unmount());stub.deregister();hooks.deregister();delete globalThis.keyboardQueueApi;}
});

test('text editing keeps arrows native and cannot dispatch by Enter',()=>{const f=formControls(),phone=f.fields[1];for(const key of ['ArrowDown','ArrowUp','ArrowRight','ArrowLeft']){const e=keyboard(key,{target:phone,currentTarget:f.root});enterNextField(e);assert.equal(e.defaultPrevented,false);assert.equal(f.focused,'');}});
