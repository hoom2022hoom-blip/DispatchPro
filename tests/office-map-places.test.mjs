import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
test('map places share existing persisted CRUD, zoom labels, relocate, search and confirmed deletion',async()=>{
 const hooks=receptionRenderHooks();const stubs=registerHooks({resolve(s,c,next){if(s==='react-map-gl/maplibre')return{url:'data:text/javascript,export const Marker="place-marker",Popup="place-popup";',shortCircuit:true};if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.placesTestApi;',shortCircuit:true};return next(s,c);}});
 const priorWindow=globalThis.window;globalThis.window={confirm:()=>false};let model,view,focus;const requests=[];
 let rows=[{id:'p',name:'مستشفى النجاح',addressText:'المدخل الرئيسي',latitude:32.24,longitude:35.27,isActive:true,sortOrder:0,version:1}];
 globalThis.placesTestApi={administration:async(path,method='GET',body)=>{requests.push({path,method,body});if(method==='GET')return rows;if(method==='DELETE'){rows=[];return{};}const saved={...body,id:body.id||'new',version:(body.version||0)+1};rows=[saved];return saved;}};
 try{const {useOfficeMapPlaces}=await import('../src/components/office-map-places.tsx');function Harness(){model=useOfficeMapPlaces(p=>focus=p);return React.createElement(React.Fragment,null,model.overlay,model.dialog);}
 await act(async()=>{view=TestRenderer.create(React.createElement(Harness));});
 assert.equal(view.root.findAllByType('place-marker').length,1);assert.equal(view.root.findAllByType('span').filter(n=>n.children.includes('مستشفى النجاح')).length,0);
 await act(async()=>model.setZoom(15));assert.ok(view.root.findAllByType('span').some(n=>n.children.includes('مستشفى النجاح')));
 assert.equal(model.search('النجاح').length,1);await act(async()=>model.choose(rows[0]));assert.equal(focus.id,'p');
 const button=text=>view.root.findAllByType('button').find(n=>n.children.join('')===text);
 await act(async()=>button('تعديل').props.onClick());
 const name=view.root.findByType('input');await act(async()=>name.props.onChange({target:{value:'مكتب المهندس'}}));
 await act(async()=>button('تغيير الموقع على الخريطة').props.onClick());assert.equal(model.picking,true);
 await act(async()=>model.click({latitude:32.3,longitude:35.3}));
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 const update=requests.find(x=>x.method==='PUT');assert.equal(update.path,'office/suggested-places/p');assert.equal(update.body.name,'مكتب المهندس');assert.equal(update.body.latitude,32.3);assert.equal(update.body.version,1);
 await act(async()=>button('حذف').props.onClick());assert.equal(requests.filter(x=>x.method==='DELETE').length,0);
 globalThis.window.confirm=()=>true;await act(async()=>button('حذف').props.onClick());assert.equal(requests.at(-1).path,'office/suggested-places/p?version=2');assert.equal(model.places.length,0);
 await act(async()=>{model.begin();});await act(async()=>model.click({latitude:32.2,longitude:35.2}));await act(async()=>view.root.findByType('input').props.onChange({target:{value:'نقطة تجمع'}}));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(requests.at(-1).method,'POST');
 }finally{await act(async()=>view?.unmount());hooks.deregister();stubs.deregister();globalThis.window=priorWindow;delete globalThis.placesTestApi;}
});
