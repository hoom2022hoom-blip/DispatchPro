import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('Customer production proxy uses the fixed API while local-only deployment retains loopback and office binding',async()=>{
 const savedPublic=process.env.DISPATCHPRO_PUBLIC_API_URL,savedLocal=process.env.DISPATCHPRO_API_URL;
 const captured=[];globalThis.stableDomainProxy=(...args)=>{captured.push(args);return Response.json({});};
 const hooks=registerHooks({resolve(s,c,next){
  if(s==='@/lib/customer-proxy')return {url:'data:text/javascript,export const proxyCustomer=(...args)=>globalThis.stableDomainProxy(...args);',shortCircuit:true};
  if(s==='@/lib/office-deployment')return {url:'data:text/javascript,export const configuredOffice=()=>"bound-office";',shortCircuit:true};
  return next(s,c);
 }});
 try{
  const source=ts.transpileModule(readFileSync(new URL('../src/app/api/customer/[...path]/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
  const route=await import('data:text/javascript,'+encodeURIComponent(source));
  process.env.DISPATCHPRO_API_URL='http://127.0.0.1:9010';process.env.DISPATCHPRO_PUBLIC_API_URL='https://api.nablustaxi.com';
  const request=new Request('https://office.nablustaxi.com/api/customer/updates');const context={params:Promise.resolve({path:['updates']})};
  await route.GET(request,context);assert.equal(captured[0][2],'https://api.nablustaxi.com');assert.equal(captured[0][4],'bound-office');
  delete process.env.DISPATCHPRO_PUBLIC_API_URL;await route.GET(request,context);assert.equal(captured[1][2],'http://127.0.0.1:9010');
 }finally{
  if(savedPublic===undefined)delete process.env.DISPATCHPRO_PUBLIC_API_URL;else process.env.DISPATCHPRO_PUBLIC_API_URL=savedPublic;
  if(savedLocal===undefined)delete process.env.DISPATCHPRO_API_URL;else process.env.DISPATCHPRO_API_URL=savedLocal;
  delete globalThis.stableDomainProxy;hooks.deregister();
 }
});
