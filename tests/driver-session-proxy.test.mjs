import test from 'node:test';import assert from 'node:assert/strict';
import {driverSessionProxy} from '../src/lib/driver-session-proxy.ts';
test('browser receives HttpOnly driver refresh cookie without exposing it or changing office cookie',async()=>{
 const request=new Request('https://office.example/api/reception/auth/driver-login',{method:'POST',headers:{Origin:'https://office.example','Content-Type':'application/json'},body:JSON.stringify({username:'driver',password:'test',tenant:'wrong'})});
 let body;const response=await driverSessionProxy(request,'auth/driver-login','http://localhost:9010','office',async(url,options)=>{body=JSON.parse(options.body);return Response.json({accessToken:'access',refreshToken:'secret',tenant:'office'});});
 assert.equal(body.tenant,'office');assert.equal((await response.json()).refreshToken,undefined);assert.match(response.headers.get('set-cookie'),/dispatchpro.driver.refresh=secret;.*HttpOnly; SameSite=Strict; Secure/);assert.doesNotMatch(response.headers.get('set-cookie'),/office.session/);
});
test('cross-origin renewal is rejected before calling backend',async()=>{
 const response=await driverSessionProxy(new Request('https://office.example/api/reception/auth/driver-refresh',{method:'POST',headers:{Origin:'https://attacker.example'}}),'auth/driver-refresh','http://localhost:9010','office',()=>{throw Error('must not call');});assert.equal(response.status,403);
});
