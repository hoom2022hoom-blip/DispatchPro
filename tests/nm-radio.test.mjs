import test from 'node:test';
import assert from 'node:assert/strict';
import {radioPath} from '../src/lib/radio-api-path.ts';
import {driverSessionProxy} from '../src/lib/driver-session-proxy.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
test('RADIO scopes auth and GPS while retaining the existing voice transport',()=>{
 for(const action of ['login','refresh','logout'])assert.equal(radioPath('/api/reception/auth/driver-'+action),'/api/reception/auth/radio-'+action);
 for(const action of ['me','location'])assert.equal(radioPath('/api/reception/driver/'+action),'/api/reception/radio/'+action);
 for(const path of ['voice/session','voice/updates?sessionId=a','driver/rides/id/status'])assert.equal(radioPath('/api/reception/'+path),'/api/reception/'+path);
 assert.equal(radioPath('https://evil.test/api/reception/driver/me'),'https://evil.test/api/reception/driver/me');
});
test('RADIO proxy binds office tenant and keeps browser refresh cookie separate',async()=>{
 let called;
 const fetch=async(url,init)=>{called={url,body:JSON.parse(init.body)};return Response.json({accessToken:'test-access',refreshToken:'test-refresh',tenant:'office'});};
 const r=await driverSessionProxy(new Request('https://office.test/api/reception/auth/radio-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'other',username:'same-driver',password:'12345678'})}),'auth/radio-login','https://api.test','office',fetch);
 assert.equal(called.url,'https://api.test/api/v1/auth/radio-login');assert.equal(called.body.tenant,'office');assert.match(r.headers.get('set-cookie'),/^dispatchpro\.radio\.refresh=/);assert.equal((await r.json()).refreshToken,undefined);
 const native=await driverSessionProxy(new Request('https://office.test/api/reception/auth/radio-login',{method:'POST',headers:{'Content-Type':'application/json','X-Driver-Session':'native'},body:JSON.stringify({username:'same-driver',password:'12345678'})}),'auth/radio-login','https://api.test','office',fetch);
 assert.equal((await native.json()).refreshToken,'test-refresh');assert.equal(native.headers.get('set-cookie'),null);
});
test('office proxy forwards independent GPS and app permission endpoints with actor token',async()=>{
 for(const [method,path] of [['GET','radio/me'],['PUT','radio/location'],['PUT','office/drivers/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/app-access']]){
 let call;const request=new Request('https://office.test/api/reception/'+path,{method,headers:{Authorization:'Bearer actor',...(method==='PUT'?{'Content-Type':'application/json'}:{})},...(method==='PUT'?{body:'{}'}:{})});
 const r=await proxyReception(request,path.split('/'),'https://api.test',async(url,init)=>{call={url,init};return Response.json({ok:true});});
 assert.equal(r.status,200);assert.equal(call.url,'https://api.test/api/v1/'+path);assert.equal(call.init.headers.Authorization,'Bearer actor');
 }
});
