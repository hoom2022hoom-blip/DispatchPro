import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {customerMobile} from './helpers/customer-mobile.mjs';
test('legacy customer credentials without registered flag use server verification instead of requesting another SMS',async()=>{
 const app=await customerMobile({restoreDevice:false});
 vm.runInContext("device={tenant:'isolated-office',accountId:'11111111-1111-1111-1111-111111111111',deviceSecret:'test-only'};",app.context);
 await app.nodes.get('resume').onclick();assert.equal(app.calls.some(c=>c.url.endsWith('/otp/request')),false);assert.ok(app.calls.some(c=>c.url.endsWith('/login')));assert.equal(app.nodes.get('account').hidden,false);
});
test('an unverified legacy customer remains locked when secure login rejects it',async()=>{
 const app=await customerMobile({restoreDevice:false,handlers:new Map([['POST login',()=>({status:401,body:{code:'PHONE_VERIFICATION_REQUIRED',detail:'هذا الحساب يحتاج التحقق من رقم الهاتف. استخدم التسجيل أو الاستعادة.'}})]])});
 vm.runInContext("device={tenant:'isolated-office',accountId:'11111111-1111-1111-1111-111111111111',deviceSecret:'test-only'};",app.context);
 await app.nodes.get('resume').onclick();assert.equal(app.nodes.get('account').hidden,true);assert.match(app.nodes.get('error').textContent,/التحقق من رقم الهاتف/);assert.equal(app.calls.some(c=>c.url.endsWith('/register')),false);
});
