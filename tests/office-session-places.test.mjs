import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiReceptionBackend, ReceptionApiError} from '../src/lib/reception-api.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
import {receptionError} from '../src/lib/reception-feedback.ts';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('office 401 clears local session and polling cannot retry protected requests',async()=>{
 const status=401;
 let calls=0;const api=createApiReceptionBackend(async url=>{calls++;return url.endsWith('auth/login')?Response.json({accessToken:'isolated-test-token'}):Response.json({}, {status});});
 await api.login('isolated-office','isolated-user','isolated-test-password');
 await assert.rejects(api.office(),e=>e instanceof ReceptionApiError&&e.status===status);
 assert.equal(api.session(),null);await assert.rejects(api.office(),e=>e.status===401);assert.equal(calls,2);
});
test('suggested places 403 retains the same bearer for orders and office polling',async()=>{
 const calls=[];const api=createApiReceptionBackend(async(url,init)=>{
  calls.push({url,authorization:init.headers.Authorization});
  return url.endsWith('auth/login')?Response.json({accessToken:'employee'}):url.endsWith('office/suggested-places')?Response.json({}, {status:403}):Response.json({rides:[]});
 });
 await api.login('isolated-office','dispatcher','test');
 await api.office();
 await assert.rejects(api.administration('office/suggested-places'),e=>{
  assert.equal(e.status,403);assert.equal(receptionError(e),'ليس لديك صلاحية للوصول إلى هذه الصفحة');return true;
 });
 assert.equal(api.session().tenant,'isolated-office');
 await api.office();await api.administration('reception/snapshot');
 assert.ok(calls.slice(1).every(call=>call.authorization==='Bearer employee'));
 assert.equal(calls.filter(call=>call.url.endsWith('auth/login')).length,1);
});
test('valid employee transport retains session and suggested-place writes forward only employee bearer',async()=>{
 const api=createApiReceptionBackend(async url=>Response.json(url.endsWith('auth/login')?{accessToken:'employee'}:{today:'2026-10-02'}));await api.login('isolated','user','test');assert.equal((await api.office()).today,'2026-10-02');assert.equal(api.session().tenant,'isolated');
 const id='11111111-1111-4111-8111-111111111111';let called=0;
 for(const [route,method] of [['office/suggested-places','POST'],[`office/suggested-places/${id}`,'PUT'],[`office/suggested-places/${id}`,'DELETE'],[`rides/${id}/locations`,'PUT'],['driver/places','GET']]){
  const r=await proxyReception(new Request('http://127.0.0.1:9005/api/reception/'+route,{method,headers:{Authorization:'Bearer employee'},...(method==='GET'?{}:{body:'{}'})}),route.split('/'),'http://127.0.0.1:9010',async(url,init)=>{called++;assert.equal(init.headers.Authorization,'Bearer employee');return Response.json({ok:true});});assert.equal(r.status,200);
 }
 assert.equal(called,5);
});
test('customer starts booking after restoring terminal history, and My Orders loads bounded own history',async()=>{
 const h=await customerMobile({rides:[{id:'old',status:'COMPLETED',rideStatus:'COMPLETED',createdAt:'2026-10-01',pickup:'old pickup',destination:'old destination',finalFare:45,currency:'ILS'}],handlers:new Map([['GET history',async()=>({body:{page:1,total:1,items:[{id:'old',status:'COMPLETED',createdAt:'2026-10-01',pickup:'old pickup',destination:'old destination',finalFare:45,currency:'ILS'}]}})]])});
 assert.equal(h.nodes.get('ride-form').hidden,false);assert.equal(h.nodes.get('request-panel').hidden,false);h.nodes.get('history-tab').onclick();await h.flush();assert.equal(h.nodes.get('request-panel').hidden,true);assert.equal(h.nodes.get('history-panel').hidden,false);assert.match(JSON.stringify(h.nodes.get('history').children[0],(key,value)=>['parentNode','parentElement','ownerDocument'].includes(key)?undefined:value),/45/);
});
test('opening destination again refreshes newly activated office places; typing does not call API',async()=>{
 const handlers=new Map();const h=await customerMobile({handlers});handlers.set('GET places',async()=>({body:{suggestedPlaces:[{id:'new',label:'موقع المكتب',addressText:'عنوان المكتب',latitude:32.2,longitude:35.2}]}}));
 h.nodes.get('open-destination').onclick();await h.flush();assert.equal(h.nodes.get('suggested-chips').children.length,1);const calls=h.calls.length;h.nodes.get('destination-query').value='المكتب';h.nodes.get('destination-query').oninput();assert.equal(h.calls.length,calls);
});
