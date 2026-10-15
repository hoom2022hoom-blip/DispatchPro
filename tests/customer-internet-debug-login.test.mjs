import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCustomerSession} from '../public/customer-mobile/session.js';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('Debug requests a variable OTP without activation and completes normal proof registration',async()=>{
 const app=await customerMobile({restoreDevice:false,handlers:new Map([
  ['POST test-otp/request',({init})=>{assert.equal(JSON.parse(init.body).testAccessCode,undefined);return{body:{challengeId:'test-challenge',developmentOnly:true,debugCode:'761483'}};}],
  ['POST otp/verify',()=>({body:{verificationProof:'test-only-proof'}})],
  ['POST register',({init})=>{assert.equal(JSON.parse(init.body).verificationProof,'test-only-proof');assert.equal(JSON.parse(init.body).testAccessCode,undefined);return{body:{accessToken:'test-session'}};}]
 ])});
 vm.runInContext('window.dispatchProCustomerDebug=true;window.dispatchProCustomerTestOtp=true;device={tenant:"",accountId:"11111111-1111-1111-1111-111111111111",phone:"0592081197",registered:false};',app.context);
 await vm.runInContext('requestOtp()',app.context);
 assert.match(app.nodes.get('otp-note').textContent,/761483/);
 assert.match(app.nodes.get('otp-note').textContent,/رمز اختبار - Debug فقط/);
 app.nodes.get('otp-form').elements.code.value='761483';await app.submit('otp-form');
 assert.equal(app.nodes.get('account').hidden,false);
});
test('Release does not request a test challenge even with a test hook present',async()=>{
 const app=await customerMobile({restoreDevice:false});
 vm.runInContext('window.dispatchProCustomerDebug=false;window.dispatchProCustomerTestOtp=true;device={tenant:"",accountId:"11111111-1111-1111-1111-111111111111",phone:"0592081197",registered:false};',app.context);
 await vm.runInContext('requestOtp()',app.context);
 assert.ok(app.calls.some(c=>c.url==='/api/customer/otp/request'));
 assert.equal(app.calls.some(c=>c.url.includes('test-otp')),false);
});
test('test challenge transport only marks an actual Debug caller',async()=>{
 const previous=globalThis.window;
 try{
  for(const debug of [true,false]){
   globalThis.window={dispatchProCustomerDebug:debug};let init;
   const session=createCustomerSession({device:()=>null,fetchImpl:async(_,request)=>{init=request;return Response.json({});}});
   await session.raw('test-otp/request','POST',{phone:'0592081197'});
   assert.equal(init.headers['X-Customer-Debug'],debug?'1':undefined);
  }
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
