import test from 'node:test';
import assert from 'node:assert/strict';
import {proxyReception} from '../src/lib/reception-proxy.ts';
test('shortcut proxy permits authenticated GET and PUT only and forwards user token unchanged',async()=>{
 const seen=[];const transport=async(url,init)=>{seen.push({url,init});return Response.json({code:'F2'});};
 for(const method of ['GET','PUT']){const r=await proxyReception(new Request('https://office.example/api/reception/voice/shortcut',{method,headers:{Authorization:'Bearer employee-token',Origin:'https://office.example',...(method==='PUT'?{'Content-Type':'application/json'}:{})},...(method==='PUT'?{body:JSON.stringify({code:'F2'})}:{})}),['voice','shortcut'],'http://127.0.0.1:9010',transport);assert.equal(r.status,200);assert.equal(new Headers(seen.at(-1).init.headers).get('authorization'),'Bearer employee-token');assert.equal(seen.at(-1).url,'http://127.0.0.1:9010/api/v1/voice/shortcut');}
 for(const method of ['POST','DELETE'])assert.equal((await proxyReception(new Request('https://office.example/api/reception/voice/shortcut',{method}),['voice','shortcut'],'http://127.0.0.1:9010',transport)).status,404);
 assert.equal(seen.length,2);
});
