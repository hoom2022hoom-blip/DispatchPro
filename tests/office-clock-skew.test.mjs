import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';

test('fresh Office login and reload use server time when the device clock is ahead',async()=>{
 const oldWindow=globalThis.window,now=Date.now;
 const serverNow=now(),storage=new Map(),calls=[];
 const token='test.'+Buffer.from(JSON.stringify({exp:Math.floor(serverNow/1000)+1800,tenant:'office-id',sub:'employee-id'})).toString('base64url')+'.test';
 globalThis.window={location:new URL('https://office.nablustaxi.com/office/orders'),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 Date.now=()=>serverNow+3600000;
 const transport=async(path)=>{calls.push(path);return Response.json(path.endsWith('auth/login')?{accessToken:token,expiresIn:1800,tenant:'office'}:{drivers:[]},{headers:{Date:new Date(serverNow).toUTCString()}});};
 try{
  const api=createApiReceptionBackend(transport);await api.bootstrap();await api.login('','employee','synthetic-password');
  await api.office();assert.ok(api.authSnapshot().authenticated);assert.ok(storage.size);
  const reloaded=createApiReceptionBackend(transport);await reloaded.bootstrap();await reloaded.office();assert.ok(reloaded.authSnapshot().authenticated);
  assert.equal(calls.filter(p=>p.endsWith('auth/login')).length,1);
  Date.now=()=>serverNow+3600000+1801000;
  await assert.rejects(reloaded.office(),e=>e.status===401);assert.equal(reloaded.authSnapshot().authenticated,false);
 }finally{Date.now=now;globalThis.window=oldWindow;}
});

test('server-validated cookie restoration survives clock skew and disabled browser storage',async()=>{
 const oldWindow=globalThis.window,now=Date.now,serverNow=Date.now();
 const token='test.'+Buffer.from(JSON.stringify({exp:Math.floor(serverNow/1000)+1800,tenant:'office-id',sub:'employee-id'})).toString('base64url')+'.test';
 globalThis.window={location:new URL('https://office.nablustaxi.com/office/orders'),sessionStorage:{getItem(){throw new Error('Storage blocked');},removeItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Storage blocked');}}};
 Date.now=()=>serverNow+3600000;
 try{
  const api=createApiReceptionBackend(async path=>Response.json(path.endsWith('auth/session')?{accessToken:token,tenant:'office'}:{drivers:[]},{headers:{Date:new Date(serverNow).toUTCString()}}),true);
  await api.bootstrap();await api.office();assert.ok(api.authSnapshot().authenticated);
 }finally{Date.now=now;globalThis.window=oldWindow;}
});
