import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';

import {registerHooks} from 'node:module';
const dynamicStub=()=>registerHooks({resolve(s,c,next){if(s==='next/dynamic')return{url:'data:text/javascript,export default ()=>"point-map";',shortCircuit:true};return next(s,c);}});
for(const target of ['pickup','destination'])test('large '+target+' picker stages real coordinates, confirms once and cancels safely',async()=>{
 const hooks=receptionRenderHooks(),stub=dynamicStub();let view;const writes=[],point={latitude:32.226789,longitude:35.261234};
 try{const {OfficeOrderDestination}=await import('../src/components/office-order-destination.tsx');const props={target,value:'عنوان الموظف',point,onChange:(...args)=>writes.push(args)};
 const button=text=>view.root.findAllByType('button').find(b=>b.children.join('')===text);
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeOrderDestination,props));});
 await act(async()=>view.root.findByProps({readOnly:true}).props.onClick());
 assert.deepEqual(view.root.findByType('point-map').props.point,point);
 const next={latitude:32.24,longitude:35.28};await act(async()=>view.root.findByType('point-map').props.onChange(next));assert.equal(writes.length,0);
 await act(async()=>button('تأكيد الموقع').props.onClick());assert.deepEqual(writes,[['عنوان الموظف',next]]);
 await act(async()=>view.root.findByProps({readOnly:true}).props.onClick());
 await act(async()=>view.root.findByProps({'aria-label':'اسم أو وصف الموقع'}).props.onChange({target:{value:'تعديل ملغى'}}));await act(async()=>button('إلغاء').props.onClick());assert.equal(writes.length,1);
 await act(async()=>view.root.findByProps({readOnly:true}).props.onClick());assert.deepEqual(view.root.findByType('point-map').props.point,point);
 assert.equal(view.root.findByProps({'aria-label':'مصدر الخريطة'}).props.value,'open');assert.match(view.root.findByType('dialog-content').props.className,/80dvh/);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();}
});
test('suggested places coexist with manual text and missing key keeps OpenFreeMap',async()=>{
 const hooks=receptionRenderHooks(),stub=dynamicStub();let view;const writes=[];
 try{const {OfficeOrderDestination}=await import('../src/components/office-order-destination.tsx');
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeOrderDestination,{value:'',places:async()=>[{id:'a',name:'موقع المكتب',addressText:'عنوان المكتب',latitude:32.3,longitude:35.3,isActive:true},{id:'hidden',name:'Hidden',isActive:false}],onChange:(...args)=>writes.push(args)}));});
 const button=text=>view.root.findAllByType('button').find(b=>b.children.join('')===text);
 await act(async()=>view.root.findByProps({readOnly:true}).props.onClick());assert.equal(button('Hidden'),undefined);assert.equal(view.root.findAllByType('option').find(n=>n.props.value==='google').props.disabled,true);
 await act(async()=>button('موقع المكتب').props.onClick());assert.equal(writes.length,0);await act(async()=>button('تأكيد الموقع').props.onClick());assert.deepEqual(writes.at(-1),['موقع المكتب · عنوان المكتب',{latitude:32.3,longitude:35.3}]);
 await act(async()=>view.root.findByProps({readOnly:true}).props.onClick());await act(async()=>view.root.findByProps({'aria-label':'اسم أو وصف الموقع'}).props.onChange({target:{value:'عنوان يدوي'}}));await act(async()=>button('تأكيد الموقع').props.onClick());assert.deepEqual(writes.at(-1),['عنوان يدوي',undefined]);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();}
});
