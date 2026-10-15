import test from 'node:test';import assert from 'node:assert/strict';import {customerMobile} from './helpers/customer-mobile.mjs';
test('Customer app startup completes account restore before polling; optional permission errors retain account',async()=>{const app=await customerMobile({handlers:new Map([['GET updates',()=>({status:403,body:{detail:'Denied'}})]])});assert.equal(app.nodes.get('account').hidden,false);assert.equal(app.nodes.get('welcome').hidden,true);assert.deepEqual(app.calls.slice(0,3).map(c=>c.url.split('?')[0]),['/api/customer/login','/api/customer/me','/api/customer/updates']);assert.ok(app.calls.filter(c=>!c.url.endsWith('/login')).every(c=>c.init.headers.Authorization));assert.ok(app.storage.has('dispatchpro.customer.device.v1'));});
test('Customer app offline polling leaves restored identity available and schedules reconnect',async()=>{const app=await customerMobile({handlers:new Map([['GET updates',()=>{throw new TypeError('network unavailable');}]])});assert.equal(app.nodes.get('account').hidden,false);assert.equal(app.nodes.get('welcome').hidden,true);assert.ok(app.timers.some(t=>t.ms>1000));assert.ok(app.storage.has('dispatchpro.customer.device.v1'));});

test('Customer pending registration requires OTP proof before installing the returned JWT',async()=>{
 const app=await customerMobile({restoreDevice:false,handlers:new Map([
  ['POST otp/request',()=>({body:{challengeId:'challenge'}})],
  ['POST otp/verify',({init})=>{assert.equal(JSON.parse(init.body).code,'123456');return {body:{verificationProof:'test-proof'}};}],
  ['POST register',({init})=>{assert.equal(JSON.parse(init.body).verificationProof,'test-proof');return {body:{accessToken:'registered-token'}};}]
 ])});
 const account={tenant:'isolated-office',accountId:'11111111-1111-1111-1111-111111111111',deviceSecret:'test-only',registered:false};
 app.context.localStorage.setItem('dispatchpro.customer.device.v1',JSON.stringify(account));
 const vm=await import('node:vm');vm.runInContext('device=JSON.parse(localStorage.getItem(key));',app.context);
 await app.nodes.get('resume').onclick();assert.equal(app.nodes.get('account').hidden,true);assert.equal(app.calls.some(c=>c.url.endsWith('/register')),false);
 app.nodes.get('otp-form').elements.code.value='123456';await app.submit('otp-form');
 assert.equal(app.nodes.get('account').hidden,false);assert.equal(app.calls.find(c=>c.url.endsWith('/me')).init.headers.Authorization,'Bearer registered-token');
});
