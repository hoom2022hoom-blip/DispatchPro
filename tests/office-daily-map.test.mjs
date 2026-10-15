import {mockFleetMap,sourceData} from './helpers/fleet-map.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const event=key=>({key,repeat:false,nativeEvent:{isComposing:false},preventDefault(){},stopPropagation(){}});

test('keyboard stages a driver, focuses Send and sends only on the next activation',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='./shift-picker')return{url:'data:text/javascript,export const ShiftPicker="driver-picker";',shortCircuit:true};return next(s,c);}});let view,release;let calls=0;
 try{const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeReceptionTable,{rides:[{id:'r',createdAt:new Date(),status:'pending',pickup:{name:'X'}}],drivers:[{id:'d',name:'Driver'}],choices:[],sendChoices:[{id:'d',label:'Driver'}],onSend:async()=>{calls++;await new Promise(r=>release=r);},onAssign:async()=>{},onSave:async()=>{},onEdit:()=>{},onDuplicate:async()=>{}}));});
 const {SendPhoneMenu}=await import('../src/components/send-phone-menu.tsx');
 await act(async()=>view.root.findByType('driver-picker').props.onChange('d'));assert.equal(calls,0);
 const props=view.root.findByType(OfficeReceptionTable).props;await act(async()=>view.update(React.createElement(OfficeReceptionTable,{...props,rides:[{...props.rides[0],driverId:'d'}]})));
 const send=view.root.findByType(SendPhoneMenu);await act(async()=>{void send.props.onSend(true);void send.props.onSend(true);});assert.equal(calls,1);await act(async()=>release());
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();}
});

test('picker keyboard selection focuses Send without dispatch and preserves mouse Quick Send',async()=>{
 const hooks=receptionRenderHooks();let view;let focused=0,staged=0,sent=0;const send={focus(){focused++;}};const trigger={closest:()=>({querySelector:()=>send})};
 try{const {ShiftPicker}=await import('../src/components/shift-picker.tsx');await act(async()=>{view=TestRenderer.create(React.createElement(ShiftPicker,{value:'',initialOpen:true,allowClear:false,choices:[{id:'d',label:'Driver'}],onKeyboardSelect:()=>staged++,onChange:()=>sent++}),{createNodeMock:el=>el.type==='button'?trigger:{focus(){}}});});await act(async()=>view.root.findByType('input').props.onKeyDown(event('Enter')));assert.equal(staged,1);assert.equal(sent,0);assert.equal(focused,1);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('map uses shared status groups, focuses real markers and updates without remount; last known GPS remains visible',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='next/link')return{url:'data:text/javascript,export default "a";',shortCircuit:true};if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.mapApi;',shortCircuit:true};if(s==='maplibre-gl/dist/maplibre-gl.css')return{url:'data:text/javascript,export {};',shortCircuit:true};if(s==='react-map-gl/maplibre')return{url:'data:text/javascript,'+encodeURIComponent('export default "driver-map";export const AttributionControl="attribution",Marker="marker",Popup="popup",NavigationControl="nav",Source="source",Layer="layer";'),shortCircuit:true};return next(s,c);}});
 const now=new Date().toISOString();const base={active:true,status:'Available',waitingCount:0,currentRide:null,locationStatus:'FRESH',updatedAt:now,location:{latitude:32.2,longitude:35.2,accuracy:10,updatedAt:now}};
 let data={serverTime:now,locationMaxAgeSeconds:120,drivers:[{...base,id:'a',fullName:'Available'},{...base,id:'b',fullName:'Assigned',currentRide:{id:'r',status:'Assigned'}},{...base,id:'c',fullName:'Busy',status:'Busy',currentRide:{id:'r2',status:'InProgress'},waitingCount:2},{...base,id:'d',fullName:'Offline',status:'Offline',locationStatus:'STALE_LOCATION',location:null}]};
 globalThis.mapApi={driverMap:async()=>data,driverRoute:async()=>({from:now,to:now,hasMore:false,points:[{id:'p',latitude:32.21,longitude:35.21,accuracy:10,timestamp:now}]})};let view;const moves=[];const savedTimeout=globalThis.setTimeout;let poll;
 globalThis.setTimeout=(fn,ms,...args)=>ms===5000?(poll=fn,0):savedTimeout(fn,ms,...args);
 let escape;const follows=[];globalThis.window={addEventListener:(name,fn)=>{if(name==='keydown')escape=fn;},removeEventListener(){}};
 try{const {OfficeDriverMap}=await import('../src/components/office-driver-map.tsx');const {mapDriverGroup,liveLocation,routeGeoJson}=await import('../src/lib/office-driver-map.ts');assert.deepEqual(data.drivers.map(mapDriverGroup),[0,1,2,3]);assert.equal(liveLocation(data.drivers[0],Date.now()+121000,120),null);assert.equal(routeGeoJson([]).features.length,0);
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeDriverMap),{createNodeMock:el=>el.type==='driver-map'?mockFleetMap({flyTo:arg=>moves.push(arg),easeTo:arg=>follows.push(arg),resize(){}}):{}});});
 const source=()=>view.root.findByProps({id:'office-taxis'});const features=()=>['office-taxis','office-selected-taxi'].flatMap(id=>sourceData(view,id).features);const car=id=>features().find(f=>f.properties.driverId===id);const map=view.root.findByType('driver-map');assert.equal(features().length,3);assert.equal(view.root.findAllByType('marker').length,0);
 const pick=async id=>act(async()=>map.props.onClick({features:[{layer:{id:'office-taxi-cars'},properties:{driverId:id}}]}));
 await pick('c');assert.deepEqual(moves.at(-1).center,[35.2,32.2]);assert.equal(car('c').properties.selected,true);assert.equal(view.root.findAllByProps({'aria-label':'معلومات السائق المحدد'}).length,1);
 data={...data,drivers:data.drivers.map(d=>d.id==='c'?{...d,location:{...d.location,longitude:35.3}}:d)};await act(async()=>poll());assert.equal(view.root.findByType('driver-map'),map);assert.equal(car('c').geometry.coordinates[0],35.3);
 const button=text=>view.root.findAllByType('button').find(b=>b.children.join('')===text);
 await act(async()=>button('متابعة السيارة').props.onClick());assert.deepEqual(follows.at(-1).center,[35.3,32.2]);
 await act(async()=>button('إيقاف المتابعة').props.onClick());const count=follows.length;
 data={...data,drivers:data.drivers.map(d=>d.id==='c'?{...d,location:{...d.location,longitude:35.4}}:d)};await act(async()=>poll());assert.equal(follows.length,count);
 await act(async()=>view.root.findByProps({'aria-label':'ملء الشاشة'}).props.onClick());assert.ok(view.root.findByType('section').props.className.includes('fixed inset-0'));await act(async()=>escape({key:'Escape'}));assert.equal(view.root.findAllByProps({'aria-label':'معلومات السائق المحدد'}).length,0);
 await pick('c');await act(async()=>button('متابعة السيارة').props.onClick());const freshTime=Date.parse(now),followCount=follows.length;data={...data,serverTime:new Date(freshTime+480000).toISOString()};await act(async()=>poll());assert.equal(car('c').properties.icon,'taxi-gray');assert.deepEqual(car('c').geometry.coordinates,[35.4,32.2]);assert.equal(follows.length,followCount);assert.equal(button('إيقاف المتابعة').props.disabled,true);
 const freshAt=new Date(freshTime+481000).toISOString();data={...data,serverTime:freshAt,drivers:data.drivers.map(d=>d.id==='c'?{...d,locationStatus:'FRESH',location:{...d.location,longitude:35.5,updatedAt:freshAt}}:d)};await act(async()=>poll());assert.equal(car('c').properties.icon,'taxi-blue');assert.deepEqual(follows.at(-1).center,[35.5,32.2]);assert.equal(view.root.findByType('driver-map'),map);
 data={...data,drivers:data.drivers.map(d=>d.id==='c'?{...d,status:'Offline'}:d)};await act(async()=>poll());assert.equal(car('c').properties.icon,'taxi-red');await pick('d');assert.equal(view.root.findAllByProps({'aria-label':'معلومات السائق المحدد'}).length,1);assert.match(JSON.stringify(view.toJSON()),/لا يوجد موقع مسجل/);
 }finally{await act(async()=>view?.unmount());globalThis.setTimeout=savedTimeout;stub.deregister();hooks.deregister();delete globalThis.mapApi;delete globalThis.window;}
});

test('daily history sends date, driver, status, source and search to server, resets paging',async()=>{
 const hooks=receptionRenderHooks();const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.dailyApi;',shortCircuit:true};return next(s,c);}});let view;const calls=[];globalThis.dailyApi={reportDrivers:async()=>[{id:'d',fullName:'Driver'}],reportHistory:async f=>{calls.push(f);return{total:51,pageSize:50,items:[{id:'r',driverName:'Driver',acceptedAt:'2026-01-01',notes:'Notes'}],summary:{statuses:[],sources:[],drivers:[],areas:[]}};}};const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,210));});
 try{const {OfficeOrderReport}=await import('../src/components/office-order-report.tsx');await act(async()=>{view=TestRenderer.create(React.createElement(OfficeOrderReport,{daily:true,today:'2026-10-01',drivers:[{id:'d',fullName:'Driver'}]}));});await settle();assert.equal(calls.at(-1).from,'2026-10-01');await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='اليوم السابق').props.onClick());await settle();assert.equal(calls.at(-1).to,'2026-09-30');
 const selects=view.root.findAllByType('select');await act(async()=>{selects[0].props.onChange({target:{value:'active'}});selects[1].props.onChange({target:{value:'d'}});view.root.findByProps({'aria-label':'مصدر الطلب'}).props.onChange({target:{value:'CUSTOMER_APP'}});view.root.findAllByType('input').find(i=>i.props.maxLength===150).props.onChange({target:{value:'Driver'}});});await settle();assert.deepEqual({...calls.at(-1)},{kind:'orders',from:'2026-09-30',to:'2026-09-30',search:'Driver',status:'active',source:'CUSTOMER_APP',driverId:'d',fareMode:'',fareSource:'',page:1});await act(async()=>view.root.findAllByType('button').find(b=>b.children.join('')==='التالي').props.onClick());await settle();assert.equal(calls.at(-1).page,2);
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.dailyApi;}
});

test('midnight rolls daily orders forward, retains active trips and never exempts old pending calls',async()=>{
 const hooks=receptionRenderHooks();const DateOriginal=globalThis.Date,intervalOriginal=globalThis.setInterval;let tick,view;let clock=Date.parse('2026-10-01T20:59:59Z');globalThis.Date=class extends DateOriginal{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};globalThis.setInterval=(fn,ms)=>ms===60000?(tick=fn,0):intervalOriginal(fn,ms);
 try{const {OfficeReceptionTable}=await import('../src/components/office-reception-table.tsx');const base={pickup:{name:'X'},status:'pending',createdAt:new DateOriginal('2026-10-01T12:00:00Z')};const props={rides:[{...base,id:'today',orderDay:'2026-10-01'},{...base,id:'old',orderDay:'2026-09-30',receptionPending:true},{...base,id:'active',status:'in-progress',orderDay:'2026-09-30'}],drivers:[],choices:[],onAssign:async()=>{},onSave:async()=>{},onEdit:()=>{},onDuplicate:async()=>{}};await act(async()=>{view=TestRenderer.create(React.createElement(OfficeReceptionTable,props));});const rows=()=>view.root.findByType('tbody').findAllByType('tr');assert.equal(rows().length,2);clock=Date.parse('2026-10-01T21:00:01Z');await act(async()=>tick());assert.equal(view.root.findByProps({'aria-label':'تاريخ الطلبات'}).props.value,'2026-10-02');assert.equal(rows().length,1);await act(async()=>view.update(React.createElement(OfficeReceptionTable,{...props,rides:props.rides.map(r=>r.id==='active'?{...r,status:'completed'}:r)})));assert.equal(rows().length,0);assert.match(JSON.stringify(view.toJSON()),/لا توجد/);
 }finally{await act(async()=>view?.unmount());globalThis.Date=DateOriginal;globalThis.setInterval=intervalOriginal;hooks.deregister();}
});

