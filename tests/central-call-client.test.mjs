import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiReceptionBackend } from '../src/lib/reception-api.ts';
import { proxyReception } from '../src/lib/reception-proxy.ts';
const event=n=>({eventId:'central-'+n,source:'LANDLINE_ICALL',phone:'0000',timestamp:`2026-10-04T12:00:0${n}.000Z`,line:'01'});
async function until(predicate){for(let i=0;i<150&&!predicate();i++)await delay(10);assert.ok(predicate(),'expected update did not arrive');}

test('office consumes only central HTTPS-proxied call state, long-polls cursor and aborts on unmount',async()=>{
 const requests=[],pending=[],errors=[];
 const api=createApiReceptionBackend(async(path,init)=>{
  requests.push(path);if(path.endsWith('/auth/login'))return Response.json({accessToken:'test',expiresIn:1800});
  if(path.includes('/call-updates?')){
   if(!path.endsWith('cursor='))return new Promise((resolve,reject)=>{pending.push({resolve,signal:init.signal});init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
   return Response.json({cursor:'first',data:event(1)});
  }
  return Response.json({});
 });
 await api.login('office-a','user','test');const seen=[];const unsubscribe=api.subscribeLatest(()=>seen.push(api.getLatestCall()));const stop=api.watchLatest(e=>errors.push(e));
 try{
  await until(()=>pending.length===1);assert.equal(api.getLatestCall().eventId,'central-1');
  pending[0].resolve(Response.json({cursor:'second',data:event(2)}));await until(()=>api.getLatestCall()?.eventId==='central-2');await until(()=>pending.length===2);
  assert.ok(requests.filter(p=>!p.endsWith('/auth/login')).every(p=>p.startsWith('/api/reception/reception/call-updates')));
  stop();await delay(20);assert.equal(pending[1].signal.aborted,true);assert.equal(errors.length,0);assert.equal(seen.length,2);
 }finally{stop();unsubscribe();api.logout();}
});

test('late call response from a signed-out office cannot appear in the next office session',async()=>{
 let finish;
 const api=createApiReceptionBackend(async path=>path.endsWith('/auth/login')?Response.json({accessToken:'test',expiresIn:1800}):path.includes('/call-updates?')?new Promise(resolve=>finish=resolve):Response.json({}));
 await api.login('office-a','user','test');const stop=api.watchLatest(()=>{});await until(()=>!!finish);api.logout();await api.login('office-b','user','test');
 finish(Response.json({cursor:'old-office',data:event(1)}));await delay(30);assert.equal(api.getLatestCall(),null);stop();api.logout();
});

test('call-update proxy forwards only employee auth and permits cancellable central long polling',async()=>{
 let forwarded;
 const request=new Request('https://office.nablustaxi.com/api/reception/reception/call-updates?cursor=ABC',{headers:{Authorization:'Bearer employee',Origin:'https://office.nablustaxi.com'}});
 const reply=await proxyReception(request,['reception','call-updates'],'https://api.nablustaxi.com',async(url,init)=>{forwarded={url,init};return Response.json({cursor:'ABC',data:null});});
 assert.equal(reply.status,200);assert.equal(forwarded.url,'https://api.nablustaxi.com/api/v1/reception/call-updates?cursor=ABC');assert.equal(forwarded.init.headers.Authorization,'Bearer employee');assert.equal(reply.headers.get('Cache-Control'),'no-store');
 assert.equal((await proxyReception(new Request(request.url),['reception','call-updates'],'https://api.nablustaxi.com')).status,401);
});
