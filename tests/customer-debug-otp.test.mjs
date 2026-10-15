import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerSession} from '../public/customer-mobile/session.js';
import {customerMobile} from './helpers/customer-mobile.mjs';
test('only Debug sends OTP disclosure header; release follows the same session transport',async()=>{
 const previous=globalThis.window;
 try{
  for(const debug of [false,true]){
   globalThis.window={dispatchProCustomerDebug:debug};let request;
   const session=createCustomerSession({device:()=>null,fetchImpl:async(url,init)=>{request={url,init};return Response.json({challengeId:'challenge',...(debug?{developmentOnly:true,debugCode:'482619'}:{})});}});
   await session.raw('otp/request','POST',{phone:'0592081197'});
   assert.equal(request.init.headers['X-Customer-Debug'],debug?'1':undefined);
   assert.equal(JSON.parse(request.init.body).phone,'0592081197');
  }
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test('Debug displays dynamic OTP from the existing response and completes normal proof/session login',async()=>{
 const app=await customerMobile({restoreDevice:false,handlers:new Map([
  ['POST otp/request',()=>({body:{challengeId:'challenge',developmentOnly:true,debugCode:'482619'}})],
  ['POST otp/verify',({init})=>{assert.equal(JSON.parse(init.body).code,'482619');return{body:{verificationProof:'bound-proof'}};}],
  ['POST register',({init})=>{assert.equal(JSON.parse(init.body).verificationProof,'bound-proof');return{body:{accessToken:'debug-normal-token'}};}]
 ])});
 const vm=await import('node:vm');
 vm.runInContext('window.dispatchProCustomerDebug=true;device={tenant:"isolated-office",accountId:"11111111-1111-1111-1111-111111111111",phone:"0592081197",registered:false};',app.context);
 await app.nodes.get('resume').onclick();assert.match(app.nodes.get('otp-note').textContent,/482619/);
 app.nodes.get('otp-form').elements.code.value='482619';await app.submit('otp-form');
 assert.equal(app.nodes.get('account').hidden,false);assert.equal(app.calls.find(c=>c.url.endsWith('/me')).init.headers.Authorization,'Bearer debug-normal-token');
});
