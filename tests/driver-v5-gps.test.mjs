import test from 'node:test';import assert from 'node:assert/strict';
import {startDriverLocation} from '../src/lib/driver-location.ts';
test('stationary GPS slows acquisition, retains only latest offline fix and reconnect sends once',async()=>{
 const original={window:globalThis.window,document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),setTimeout,clearTimeout,now:Date.now};
 let now=100000,nextTimer,latestDelay,latitude=32.221;const sent=[];
 globalThis.window=new EventTarget();window.isSecureContext=true;globalThis.document=new EventTarget();document.hidden=false;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,geolocation:{getCurrentPosition(ok){ok({coords:{latitude,longitude:35.254,accuracy:10},timestamp:now});}}}});
 Date.now=()=>now;globalThis.setTimeout=(fn,delay)=>{nextTimer=fn;latestDelay=delay;return 1;};globalThis.clearTimeout=()=>{};
 let stop;const settle=()=>new Promise(setImmediate);
 try{
  stop=startDriverLocation(async point=>{sent.push(point);return {stored:true};},()=>{});await settle();assert.equal(sent.length,1);assert.equal(latestDelay,10000);
  now+=10000;nextTimer();await settle();assert.equal(sent.length,1);assert.equal(latestDelay,60000);
  navigator.onLine=false;now+=60000;latitude+=.001;nextTimer();await settle();now+=60000;latitude+=.001;nextTimer();await settle();assert.equal(sent.length,1);
  navigator.onLine=true;window.dispatchEvent(new Event('online'));await settle();assert.equal(sent.length,2);assert.equal(sent.at(-1).latitude,latitude);assert.equal(sent.at(-1).capturedAt,new Date(now).toISOString());
 }finally{stop?.();Date.now=original.now;globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;globalThis.window=original.window;globalThis.document=original.document;if(original.navigator)Object.defineProperty(globalThis,'navigator',original.navigator);else delete globalThis.navigator;}
});
