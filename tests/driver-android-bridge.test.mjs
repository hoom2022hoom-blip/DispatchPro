import test from 'node:test';
import assert from 'node:assert/strict';
import {connectNative,driverNativeFetch,nativeCall} from '../driver-android/web/native-bridge.ts';

test('Android transport reuses driver API methods and credentials, returns HTTP errors, cancels requests, and reports foreground/connectivity',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
 const channel=new MessageChannel();const received=[];let online=0,offline=0;
 window.addEventListener('online',()=>online++);window.addEventListener('offline',()=>offline++);
 channel.port2.onmessage=e=>{
  const call=JSON.parse(e.data);received.push(call);
  if(call.type==='ready')channel.port2.postMessage(JSON.stringify({id:call.id,data:{apiOrigin:'https://office.test',notifications:false,online:true,foreground:true}}));
  if(call.type==='request'&&call.path!=='driver/updates?cursor=wait')channel.port2.postMessage(JSON.stringify({id:call.id,data:{status:call.path==='driver/me'?403:200,body:JSON.stringify({ok:true})}}));
  if(call.type==='permission')channel.port2.postMessage(JSON.stringify({id:call.id,data:'granted'}));
 };
 try{
  const ready=connectNative();const event=new Event('message');Object.assign(event,{data:'dispatchpro-connect',ports:[channel.port1]});window.dispatchEvent(event);
  assert.equal((await ready).apiOrigin,'https://office.test');assert.equal(navigator.onLine,true);
  const response=await driverNativeFetch('/api/reception/rides/11111111-1111-1111-1111-111111111111/status',{method:'PUT',headers:{Authorization:'Bearer test-only'},body:JSON.stringify({status:'Accepted',version:3})});
  assert.equal(response.status,200);assert.equal(received.at(-1).authorization,'Bearer test-only');assert.equal(received.at(-1).path,'rides/11111111-1111-1111-1111-111111111111/status');assert.deepEqual(JSON.parse(received.at(-1).body),{status:'Accepted',version:3});
  assert.equal((await driverNativeFetch('/api/reception/driver/me')).status,403);
  await assert.rejects(()=>driverNativeFetch('https://arbitrary.test/'),/Unsupported/);
  assert.equal(await nativeCall('permission'),'granted');
  const abort=new AbortController();const held=driverNativeFetch('/api/reception/driver/updates?cursor=wait',{signal:abort.signal});abort.abort();await assert.rejects(()=>held,e=>e.name==='AbortError');
  channel.port2.postMessage(JSON.stringify({event:'foreground',value:false}));await new Promise(r=>setTimeout(r,10));assert.equal(navigator.onLine,false);assert.equal(offline,1);
  channel.port2.postMessage(JSON.stringify({event:'foreground',value:true}));await new Promise(r=>setTimeout(r,10));assert.equal(navigator.onLine,true);assert.equal(online,1);
 }finally{channel.port1.close();channel.port2.close();delete globalThis.window;if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
});
