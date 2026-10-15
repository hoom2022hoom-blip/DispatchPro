import test from 'node:test';import assert from 'node:assert/strict';
import {startDriverLocation} from '../src/lib/driver-location.ts';
test('GPS reconnect takes a new real observation once; no offline queue or overlapping sends',async()=>{
 const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldWin=globalThis.window,oldDoc=globalThis.document;
 const windowEvents=new EventTarget(),documentEvents=new EventTarget();windowEvents.isSecureContext=true;documentEvents.hidden=false;
 let read=0,callback,release;const sent=[];const nav={onLine:false,geolocation:{getCurrentPosition(fn){read++;callback=fn;}}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:nav});globalThis.window=windowEvents;globalThis.document=documentEvents;
 let stop;
 try{stop=startDriverLocation(async value=>{sent.push(value);await new Promise(r=>release=r);return{stored:true};},()=>{});assert.equal(read,0);nav.onLine=true;windowEvents.dispatchEvent(new Event('online'));assert.equal(read,1);windowEvents.dispatchEvent(new Event('online'));assert.equal(read,1);
 const at=Date.now()-1000;const pending=callback({coords:{latitude:32.22,longitude:35.25,accuracy:5},timestamp:at});await new Promise(setImmediate);assert.equal(sent.length,1);assert.equal(sent[0].capturedAt,new Date(at).toISOString());nav.onLine=false;windowEvents.dispatchEvent(new Event('online'));nav.onLine=true;windowEvents.dispatchEvent(new Event('online'));assert.equal(read,1);release();await pending;stop();windowEvents.dispatchEvent(new Event('online'));assert.equal(read,1);
 }finally{stop?.();globalThis.window=oldWin;globalThis.document=oldDoc;if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;}
});
