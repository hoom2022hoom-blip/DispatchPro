import test from 'node:test';
import assert from 'node:assert/strict';
import {proxyReception} from '../src/lib/reception-proxy.ts';

test('customer history proxy forwards all tabs, paging and linked-order query with the office bearer',async()=>{
 const id='b105d9bc-597d-4e6b-a99f-b19b5c4cba77';
 for(const kind of ['orders','calls','activity']){
  let forwarded;
  const query=`kind=${kind}&page=2&orderId=stored-order`;
  const response=await proxyReception(new Request(`http://localhost/api/reception/customers/${id}/history?${query}`,{headers:{Authorization:'Bearer employee'}}),['customers',id,'history'],'http://127.0.0.1:9010',async(url,init)=>{forwarded={url,init};return Response.json({items:[],total:0});});
  assert.equal(response.status,200);
  assert.equal(forwarded.url,`http://127.0.0.1:9010/api/v1/customers/${id}/history?${query}`);
  assert.equal(forwarded.init.headers.Authorization,'Bearer employee');assert.equal(forwarded.init.cache,'no-store');
 }
});
test('customer history keeps authentication, upstream failures and read-only route restrictions',async()=>{
 const id='b105d9bc-597d-4e6b-a99f-b19b5c4cba77',path=['customers',id,'history'];
 const url=`http://localhost/api/reception/customers/${id}/history`;
 assert.equal((await proxyReception(new Request(url),path,'http://127.0.0.1:9010')).status,401);
 assert.equal((await proxyReception(new Request(url,{method:'POST',headers:{Authorization:'Bearer employee'}}),path,'http://127.0.0.1:9010')).status,404);
 const response=await proxyReception(new Request(url,{headers:{Authorization:'Bearer employee'}}),path,'http://127.0.0.1:9010',async()=>Response.json({error:'Actual backend error'},{status:500}));
 assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'Actual backend error'});
});
