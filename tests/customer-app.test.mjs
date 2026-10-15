import test from 'node:test';
import assert from 'node:assert/strict';
import {proxyCustomer} from '../src/lib/customer-proxy.ts';

test('customer proxy restricts routes, requires a token and rejects foreign origins',async()=>{
  const fail=()=>{throw Error('must not forward');};
  assert.equal((await proxyCustomer(new Request('https://office.test/api/customer/me'),['me'],'http://127.0.0.1:9010',fail)).status,401);
  assert.equal((await proxyCustomer(new Request('https://office.test/api/customer/office',{headers:{Authorization:'Bearer customer'}}),['office'],'http://127.0.0.1:9010',fail)).status,404);
  assert.equal((await proxyCustomer(new Request('https://office.test/api/customer/register',{method:'POST',headers:{Origin:'https://foreign.test'},body:'{}'}),['register'],'http://127.0.0.1:9010',fail)).status,403);
});
test('customer proxy forwards only its own token and keeps authenticated responses uncached',async()=>{
  let called=false;
  const result=await proxyCustomer(new Request('https://office.test/api/customer/updates?cursor=abc',{headers:{Authorization:'Bearer customer',Cookie:'office=secret'}}),['updates'],'http://127.0.0.1:9010',async(url,init)=>{
    called=true;assert.equal(url,'http://127.0.0.1:9010/api/v1/customer-app/updates?cursor=abc');assert.equal(init.headers.Authorization,'Bearer customer');assert.equal(init.headers.Cookie,undefined);assert.equal(init.cache,'no-store');return Response.json({rides:[]});
  });assert.ok(called);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.status,200);
});
test('customer registration uses the existing API and bounds request size',async()=>{
  const body=JSON.stringify({fullName:'Customer',phone:'0591234567'});
  const result=await proxyCustomer(new Request('http://localhost/api/customer/register',{method:'POST',body}),['register'],'http://127.0.0.1:9010',async(url,init)=>{assert.equal(url,'http://127.0.0.1:9010/api/v1/customer-app/register');assert.equal(new TextDecoder().decode(init.body),body);return Response.json({});});assert.equal(result.status,200);
  assert.equal((await proxyCustomer(new Request('http://localhost/api/customer/register',{method:'POST',body:'x'.repeat(16385)}),['register'],'http://127.0.0.1:9010')).status,413);
});

test('customer places transport requires its own token and cannot expose office place or fare/driver assignment routes',async()=>{
 const base='http://127.0.0.1:9010';
 assert.equal((await proxyCustomer(new Request('https://office.test/api/customer/places'),['places'],base)).status,401);
 for(const [method,route]of [['GET','saved-addresses'],['GET','office/driver-map'],['PUT','rides/11111111-1111-1111-1111-111111111111/fare'],['PUT','rides/11111111-1111-1111-1111-111111111111/assign']])assert.equal((await proxyCustomer(new Request('https://office.test/api/customer/'+route,{method,headers:{Authorization:'Bearer customer'}}),route.split('/'),base)).status,404);
 for(const method of ['GET','POST']){
  const result=await proxyCustomer(new Request('https://office.test/api/customer/places',{method,headers:{Authorization:'Bearer customer',Cookie:'office=secret'},...(method==='POST'?{body:JSON.stringify({label:'Test only',addressText:'Isolated test address'})}:{})}),['places'],base,async(url,init)=>{assert.equal(url,base+'/api/v1/customer-app/places');assert.equal(init.headers.Authorization,'Bearer customer');assert.equal(init.headers.Cookie,undefined);return Response.json({});});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
 }
});
