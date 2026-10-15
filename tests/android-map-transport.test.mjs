import test from 'node:test';
import assert from 'node:assert/strict';

test('native driver permits only anonymous OSM GET tiles outside the API bridge',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(input,init)=>{requests.push({url:input instanceof Request?input.url:String(input),init});return new Response('tile');};
 try{
  const {driverNativeFetch}=await import('../driver-android/web/native-bridge.ts');
  assert.equal(await(await driverNativeFetch('https://tile.openstreetmap.org/14/9612/6648.png')).text(),'tile');
  assert.equal(requests.length,1);assert.equal(requests[0].init.credentials,'omit');assert.equal(requests[0].init.redirect,'error');
  for(const url of ['https://tile.openstreetmap.org/not-a-tile','https://tile.openstreetmap.org/1/2/3.png?token=x','https://arbitrary.test/1/2/3.png'])await assert.rejects(()=>driverNativeFetch(url),/Unsupported/);
  await assert.rejects(()=>driverNativeFetch('https://tile.openstreetmap.org/1/2/3.png',{headers:{Authorization:'Bearer private'}}),/Unsupported/);
  await assert.rejects(()=>driverNativeFetch(new Request('https://tile.openstreetmap.org/1/2/3.png',{headers:{Authorization:'Bearer private'}})),/Unsupported/);
  await assert.rejects(()=>driverNativeFetch('https://tile.openstreetmap.org/1/2/3.png',{method:'POST'}),/Unsupported/);
  assert.equal(requests.length,1);
 }finally{globalThis.fetch=original;}
});
