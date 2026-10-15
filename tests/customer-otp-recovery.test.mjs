import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('expired OTP never calls verify or registers and can be resent using server cooldown',async()=>{
 const app=await customerMobile({restoreDevice:false,handlers:new Map([
  ['POST otp/request',()=>({body:{challengeId:'challenge',resendAfter:10,expiresIn:20}})]
 ])});
 vm.runInContext("device={tenant:'test',accountId:'test',phone:'0561234567'}",app.context);
 await vm.runInContext('requestOtp()',app.context);
 assert.equal(vm.runInContext('Math.round((otpResendAt-Date.now())/1000)',app.context),10);
 vm.runInContext('otpExpiresAt=Date.now()-1',app.context);
 app.nodes.get('otp-form').elements.code.value='123456';await app.submit('otp-form');
 assert.equal(app.calls.some(c=>c.url.endsWith('/otp/verify')||c.url.endsWith('/register')),false);
 vm.runInContext('otpResendAt=Date.now()-1',app.context);await app.nodes.get('otp-resend').onclick();
 assert.equal(app.calls.filter(c=>c.url.endsWith('/otp/request')).length,2);
});
