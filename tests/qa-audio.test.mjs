import test from 'node:test';
import assert from 'node:assert/strict';
import {QaChatAlerts,qaTone} from '../src/lib/qa-audio.js';
import {CallRinger} from '../driver-android/web/qa-communication.js';
function fixture(t){
 const names=['dispatchProDriverQa','dispatchProCallNative','dispatchProDriverNative','dispatchProCustomerNative','dispatchProQaBrowserSound','dispatchProVisibleChat','dispatchProQaVoiceActive','dispatchProRideCallActive','localStorage','document','Notification','AudioContext','navigator'];
 const old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));for(const n of names)Reflect.deleteProperty(globalThis,n);
 const store=new Map(),notifications=[],native=[];
 Object.assign(globalThis,{dispatchProDriverQa:true,localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},document:{visibilityState:'visible'},Notification:class{static permission='granted';constructor(title,options){notifications.push({title,options});}}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{vibrate(){throw Error('native must own vibration');}}});
 t.after(()=>{for(const n of names){if(old.get(n))Object.defineProperty(globalThis,n,old.get(n));else Reflect.deleteProperty(globalThis,n);}});
 return {store,notifications,native};
}
test('incoming chat alerts once across reconnect/recreated clients; own messages never alert',t=>{
 const f=fixture(t);const data={chat:[{id:'m1',rideId:'r1',text:'test',senderName:'QA office'},{id:'mine',rideId:'r1',mine:true}]};
 new QaChatAlerts('device').consume(data);new QaChatAlerts('device').consume(data);assert.equal(f.notifications.length,1);
});
test('open visible conversation is consumed quietly and does not alert after leaving it',t=>{
 const f=fixture(t);globalThis.dispatchProVisibleChat='r';const data={chat:[{id:'m',rideId:'r'}]};const a=new QaChatAlerts('device');a.consume(data);delete globalThis.dispatchProVisibleChat;a.consume(data);assert.equal(f.notifications.length,0);
});
test('background desktop notification hides message content',t=>{
 const f=fixture(t);document.visibilityState='hidden';new QaChatAlerts('device').consume({chat:[{id:'m',rideId:'r',text:'private body',senderName:'QA'}]});assert.equal(f.notifications[0].options.body,'رسالة داخلية جديدة');assert.equal(f.notifications[0].options.silent,true);
});
test('Android chat never starts a second WebView sound or desktop notification',t=>{
 const f=fixture(t);globalThis.dispatchProDriverNative=true;globalThis.AudioContext=class{constructor(){throw Error('no WebView audio');}};new QaChatAlerts('device').consume({chat:[{id:'m',rideId:'r'}]});assert.equal(f.notifications.length,0);
});
test('short QA tones use only native bridge; production is unchanged',async t=>{
 const f=fixture(t);globalThis.dispatchProCallNative=async(type,data)=>f.native.push({type,data});qaTone('accepted','ride');await Promise.resolve();assert.deepEqual(f.native,[{type:'sound.event',data:{kind:'accepted',key:'ride'}}]);globalThis.dispatchProDriverQa=false;qaTone('accepted','other');assert.equal(f.native.length,1);
});
test('Android incoming call has one owner; outgoing ringback starts once and stops on cleanup',async t=>{
 const f=fixture(t);globalThis.dispatchProDriverNative=true;globalThis.AudioContext=class{constructor(){throw Error('no WebView ring');}};const r=new CallRinger(async(type,data)=>f.native.push({type,data}));r.start('incoming');assert.equal(f.native.filter(e=>e.data.active).length,0);r.start('outgoing');r.start('outgoing');r.stop();await Promise.resolve();assert.equal(f.native.filter(e=>e.data.active).length,1);assert.equal(f.native.at(-1).data.active,false);assert.equal(r.timer,null);
});
