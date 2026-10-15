import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';

test('address confirmation applies a draft; cancel keeps the original address and GPS',async()=>{
 const hooks=receptionRenderHooks();let view;const changes=[];
 try{const {OfficeOrderDestination}=await import('../src/components/office-order-destination.tsx');
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeOrderDestination,{value:'الأصل',point:{latitude:32.2,longitude:35.2},required:false,onChange:(...args)=>changes.push(args)}));});
 assert.equal(view.root.findByType('input').props.readOnly,true);
 await act(async()=>view.root.findByType('input').props.onClick());
 await act(async()=>view.root.findByProps({'aria-label':'اسم أو وصف الموقع'}).props.onChange({target:{value:'عنوان جديد'}}));
 await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='إلغاء').props.onClick());
 assert.deepEqual(changes,[]);assert.equal(view.root.findByType('input').props.value,'الأصل');
 await act(async()=>view.root.findByType('input').props.onClick());
 await act(async()=>view.root.findByProps({'aria-label':'اسم أو وصف الموقع'}).props.onChange({target:{value:'عنوان جديد'}}));
 await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='تأكيد الموقع').props.onClick());
 assert.equal(changes.length,1);assert.equal(changes[0][0],'عنوان جديد');
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('first send shows privacy choices; hidden phone reaches send once; state is read-only',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='./shift-picker')return{url:'data:text/javascript,export const ShiftPicker="driver-picker";',shortCircuit:true};return next(s,c);}});let view;const sends=[];
 const ride={id:'order',orderNumber:1,createdAt:new Date(),updatedAt:new Date(),pickup:{name:'',coords:{x:0,y:0}},status:'pending',totalFare:null,passengerName:'عميل',driverId:null};
 try{const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeReceptionTable,{rides:[ride],drivers:[],choices:[],onSend:async(...args)=>sends.push(args),onSave:async()=>{},onAssign:async()=>{},onEdit:()=>{},onDuplicate:async()=>{}}));});
 assert.equal(view.root.findAllByType('select').length,0);
 assert.ok(!JSON.stringify(view.toJSON()).includes('السعر لم يحدد'));
 const props=view.root.findByType(OfficeReceptionTable).props;
 await act(async()=>view.update(React.createElement(OfficeReceptionTable,{...props,rides:[{...ride,finalFare:45,fareSource:'OFFICE_MANUAL'}]})));
 assert.ok(view.root.findAllByType('small').some(n=>n.children.join('')==='45 ₪'));
 await act(async()=>view.update(React.createElement(OfficeReceptionTable,{...props,rides:[{...ride,finalFare:45,fareSource:'GPS_METER'}]})));
 assert.ok(!view.root.findAllByType('small').some(n=>n.children.join('')==='45 ₪'));
 await act(async()=>view.update(React.createElement(OfficeReceptionTable,props)));
 const {SendPhoneMenu}=await import('../src/components/send-phone-menu.tsx');
 await act(async()=>view.update(React.createElement(OfficeReceptionTable,{...props,rides:[{...ride,driverId:'driver'}]})));
 assert.equal(view.root.findAllByType('driver-picker').length,1);assert.equal(view.root.findAllByProps({'aria-label':'إظهار رقم العميل للسائق'}).length,0);
 const menu=view.root.findByType(SendPhoneMenu);await act(async()=>{await Promise.all([menu.props.onSend(false),menu.props.onSend(false)]);});
 assert.deepEqual(sends,[['order','driver',false]]);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();}
});

test('legacy nonrenewable access token keeps finite lifetime and server clock offset',async()=>{
 const oldWindow=globalThis.window,oldNow=Date.now;const start=oldNow();let now=start;const storage=new Map();
 const token='test.'+Buffer.from(JSON.stringify({exp:Math.floor(start/1000)+1800})).toString('base64url')+'.test';
 globalThis.window={sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 Date.now=()=>now+3600000;
 try{const transport=async p=>Response.json(p.endsWith('auth/login')?{accessToken:token,tenant:'office'}:{drivers:[]},{headers:{Date:new Date(now).toUTCString()}});
 const api=createApiReceptionBackend(transport);await api.login('office','user','test');now+=900000;
 const restored=createApiReceptionBackend(transport);await restored.office();assert.ok(restored.authSnapshot().authenticated);
 now=start+1801000;await assert.rejects(restored.office(),e=>e.status===401);assert.equal(restored.authSnapshot().authenticated,false);
 }finally{Date.now=oldNow;globalThis.window=oldWindow;}
});
