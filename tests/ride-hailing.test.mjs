import test from 'node:test';
import assert from 'node:assert/strict';
import {startDriverLocation} from '../src/lib/driver-location.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
import {driverTestServer} from '../driver-mobile/serve.mjs';

test('LAN HTTP explicitly reports blocked GPS instead of claiming dispatch readiness',()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 const messages=[];
 try{
  globalThis.window={isSecureContext:false};globalThis.document={hidden:false};
  const stop=startDriverLocation(async()=>assert.fail('HTTP must not send a fabricated fix'),s=>messages.push(s));
  assert.match(messages[0],/HTTPS/);stop();
 }finally{
  if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
 }
});

test('standalone Driver Mobile host admits GPS to authenticated proxy while blocking office routes',async t=>{
 const server=driverTestServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}/api/reception/`;
 const gps=await fetch(base+'driver/location',{method:'PUT',body:'{}',headers:{'Content-Type':'application/json'}});
 assert.equal(gps.status,401);await gps.text();
 const office=await fetch(base+'dispatch/policy');assert.equal(office.status,404);await office.text();
});

test('GPS sends fresh movement and heartbeat, suppresses stationary/background/offline updates and stops cleanly',async()=>{
 const savedNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');const savedDocument=globalThis.document;
 const originalTimer=globalThis.setTimeout,originalClear=globalThis.clearTimeout,originalNow=Date.now;
 let now=100000,latitude=32.22,longitude=35.25,accuracy=10,next,reads=0;
 const sent=[];let stop;
 try{
  Date.now=()=>now;globalThis.setTimeout=(fn,ms,...args)=>{if(ms!==20000&&ms!==60000)return originalTimer(fn,ms,...args);next=fn;return 1;};globalThis.clearTimeout=id=>{if(id===1)next=undefined;else originalClear(id);};
  globalThis.document={hidden:false};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,geolocation:{getCurrentPosition(ok,_error,options){reads++;assert.equal(options.enableHighAccuracy,true);assert.equal(options.maximumAge,0);ok({coords:{latitude,longitude,accuracy},timestamp:now});}}}});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  stop=startDriverLocation(async value=>{sent.push(value);},()=>{});await settle();assert.equal(sent.length,1);
  now+=20000;next();await settle();assert.equal(sent.length,1);
  now+=40000;next();await settle();assert.equal(sent.length,2);
  now+=20000;longitude+=.001;next();await settle();assert.equal(sent.length,3);
  accuracy=500;now+=60000;next();await settle();assert.equal(sent.length,3);
  const before=reads;document.hidden=true;next();assert.equal(reads,before);
  document.hidden=false;navigator.onLine=false;next();assert.equal(reads,before);
  stop();assert.equal(next,undefined);
 }finally{stop?.();Date.now=originalNow;globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalClear;if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;if(savedNavigator)Object.defineProperty(globalThis,'navigator',savedNavigator);else delete globalThis.navigator;}
});

test('dispatch proxy forwards employee-scoped GPS/settings and rejects arbitrary driver location paths',async()=>{
 const forwarded=[];const transport=async(url,options)=>{forwarded.push({url,options});return Response.json({stored:true});};
 const request=path=>new Request('http://localhost/api/reception/'+path,{method:'PUT',headers:{Authorization:'Bearer driver-token','Content-Type':'application/json'},body:JSON.stringify({latitude:32.22,longitude:35.25})});
 assert.equal((await proxyReception(request('driver/location'),['driver','location'],'http://127.0.0.1:9010',transport)).status,200);
 assert.equal(forwarded[0].options.headers.Authorization,'Bearer driver-token');
 assert.equal((await proxyReception(request('driver/location/other'),['driver','location','other'],'http://127.0.0.1:9010',transport)).status,404);
 assert.equal(forwarded.length,1);
});
