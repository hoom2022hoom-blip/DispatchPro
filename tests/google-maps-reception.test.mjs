import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {googleMapsKey,loadGoogleMaps} from '../src/lib/google-maps.ts';

test('missing Google key never injects scripts and leaves the fallback available',async()=>{
 const old=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
 try{assert.equal(googleMapsKey(),'');await assert.rejects(loadGoogleMaps(),/OpenFreeMap/);}finally{if(old)process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=old;}
});

test('official SDK maps support three types, real click/drag pins, routes and cleanup',async()=>{
 const hooks=receptionRenderHooks();let view;const picks=[],maps=[],markers=[],routeCalls=[],summaries=[];
 class NativeMap{constructor(element,options){this.options=options;this.listeners={};maps.push(this);}addListener(event,callback){this.listeners[event]=callback;return {remove(){}};}setMapTypeId(type){this.type=type;}panTo(position){this.center=position;}setZoom(zoom){this.zoom=zoom;}getZoom(){return this.zoom??14;}}
 class Marker{constructor(options){this.options=options;this.listeners={};markers.push(this);}addListener(event,callback){this.listeners[event]=callback;}setMap(map){this.map=map;}setPosition(position){this.position=position;}}
 const line={setMap(map){this.map=map;}};
 const api={Marker,event:{clearInstanceListeners(){},trigger(){}},importLibrary:async library=>library==='maps'?{Map:NativeMap}:{Route:{computeRoutes:async input=>{routeCalls.push(input);return {routes:[{distanceMeters:12500,durationMillis:1200000,createPolylines:()=>[line]}]};}}}};
 globalThis.googleSDKFixture=api;
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/google-maps'&&c.parentURL?.endsWith('google-map-canvas.tsx'))return {url:'data:text/javascript,'+encodeURIComponent('export const loadGoogleMaps=async()=>globalThis.googleSDKFixture;export const onGoogleAuthFailure=()=>()=>{};export const googlePosition=p=>({lat:p.latitude,lng:p.longitude});'),shortCircuit:true};return next(s,c);}});
 try{const {GoogleMapCanvas}=await import('../src/components/google-map-canvas.tsx');
 const props={type:'hybrid',point:{latitude:32.22,longitude:35.25},onPick:p=>picks.push(p),onFailure:()=>assert.fail('unexpected fallback')};
 await act(async()=>{view=TestRenderer.create(React.createElement(GoogleMapCanvas,props),{createNodeMock:()=>({})});});assert.equal(maps[0].options.mapTypeId,'hybrid');assert.deepEqual(markers[0].options.position,{lat:32.22,lng:35.25});assert.equal(markers[0].options.draggable,true);
 maps[0].listeners.tilesloaded();maps[0].listeners.click({latLng:{lat:()=>32.23,lng:()=>35.26}});markers[0].listeners.dragend({latLng:{lat:()=>32.24,lng:()=>35.27}});assert.deepEqual(picks,[{latitude:32.23,longitude:35.26},{latitude:32.24,longitude:35.27}]);
 for(const type of ['roadmap','satellite','hybrid']){await act(async()=>view.update(React.createElement(GoogleMapCanvas,{...props,type})));assert.equal(maps[0].type,type);assert.equal(maps.length,1);}
 await act(async()=>view.update(React.createElement(GoogleMapCanvas,{...props,routeTo:{latitude:32.1,longitude:35.1},onRoute:s=>summaries.push(s)})));assert.deepEqual(routeCalls[0].origin,{lat:32.1,lng:35.1});assert.deepEqual(routeCalls[0].destination,{lat:32.22,lng:35.25});assert.deepEqual(routeCalls[0].fields,['path','distanceMeters','durationMillis']);assert.match(summaries.at(-1),/12.5/);assert.equal(line.map,maps[0]);
 await act(async()=>view.unmount());view=null;assert.equal(line.map,null);assert.equal(markers[0].map,null);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.googleSDKFixture;}
});

test('send menu rejects missing driver, has exactly two options and suppresses double activation',async()=>{
 const hooks=receptionRenderHooks();let view,release,missing=0;const sends=[];const old=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>{fn();return 0;};
 const trigger={disabled:false,focus(){},closest(){return null;}};
 try{const {SendPhoneMenu}=await import('../src/components/send-phone-menu.tsx');const props={fontSize:16,busy:false,disabled:false,onMissing:()=>missing++,onSend:async share=>{sends.push(share);await new Promise(r=>release=r);}};
 await act(async()=>{view=TestRenderer.create(React.createElement(SendPhoneMenu,props),{createNodeMock:()=>trigger});});const root=()=>view.root.findAllByType('div').find(n=>n.props.onOpenChange);
 await act(async()=>root().props.onOpenChange(true));assert.equal(missing,1);assert.equal(root().props.open,false);assert.equal(sends.length,0);
 await act(async()=>view.update(React.createElement(SendPhoneMenu,{...props,driverId:'d'})));await act(async()=>root().props.onOpenChange(true));assert.equal(root().props.open,true);
 const options=view.root.findByType('section').findAllByType('button');assert.deepEqual(options.map(n=>n.children.join('')),['إرسال مع رقم الهاتف','إرسال بدون رقم الهاتف']);await act(async()=>{options[1].props.onClick();options[1].props.onClick();});assert.deepEqual(sends,[false]);await act(async()=>release());assert.equal(root().props.open,false);
 }finally{await act(async()=>view?.unmount());hooks.deregister();globalThis.requestAnimationFrame=old;}
});

test('row arrows preserve column position, follow RTL and leave text editing native',async()=>{
 const hooks=receptionRenderHooks();let view;const old=globalThis.HTMLElement;globalThis.HTMLElement=class{};
 const moves=[];
 const control=name=>({matches:()=>false,closest:()=>null,getClientRects:()=>[{}],focus:()=>moves.push(name)});
 const first=[control('first-name'),control('first-driver')],second=[control('second-name'),control('second-driver')];
 const next=new globalThis.HTMLElement();next.querySelectorAll=()=>second;next.scrollIntoView=()=>moves.push('scroll-nearest');next.focus=()=>moves.push('row');
 const row={querySelectorAll:()=>first,nextElementSibling:next};
 try{const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');const props={rides:[{id:'one',createdAt:new Date(),status:'pending',pickup:{name:'العنوان'}}],drivers:[],choices:[],onSave:async()=>{},onAssign:async()=>{},onEdit(){},onDuplicate:async()=>{}};
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeReceptionTable,props));});
 const key=(key,target)=>({key,target,currentTarget:row,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});
 const handler=view.root.findByProps({'data-order-row':'one'}).props.onKeyDown;
 handler(key('ArrowDown',first[1]));assert.deepEqual(moves,['second-driver','scroll-nearest']);
 handler(key('ArrowLeft',first[0]));assert.equal(moves.at(-1),'first-driver');handler(key('ArrowRight',first[1]));assert.equal(moves.at(-1),'first-name');
 const event=key('ArrowDown',{closest:()=>({})});handler(event);assert.equal(event.defaultPrevented,undefined);const before=moves.length;handler(key('Enter',first[1]));assert.equal(moves.length,before);
 await act(async()=>view.root.findByProps({'data-order-row':'one'}).props.onFocus());assert.equal(view.root.findByProps({'data-order-row':'one'}).props['aria-selected'],true);
 }finally{await act(async()=>view?.unmount());hooks.deregister();globalThis.HTMLElement=old;}
});
