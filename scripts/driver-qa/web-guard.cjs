const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),{syncBuiltinESMExports}=require('node:module');
const allowed=`http://127.0.0.1:${process.env.QA_API_PORT}`;
function check(value){const u=new URL(value);if(u.origin!==allowed){if(process.env.QA_GUARD_LOG)fs.appendFileSync(process.env.QA_GUARD_LOG,JSON.stringify({at:new Date().toISOString(),blocked:true,hostname:u.hostname})+'\n');throw Error('QA_EXTERNAL_HTTP_DISABLED');}}
const originalFetch=globalThis.fetch;globalThis.fetch=(url,...rest)=>{try{check(url instanceof Request?url.url:String(url));return originalFetch(url,...rest);}catch(e){return Promise.reject(e);}};
for(const [module,scheme] of [[http,'http:'],[https,'https:']])for(const method of ['request','get']){
 const original=module[method];module[method]=function(input,...rest){const u=typeof input==='string'||input instanceof URL?new URL(input):new URL(`${input.protocol||scheme}//${input.hostname||input.host||'localhost'}:${input.port||(scheme==='https:'?443:80)}${input.path||'/'}`);check(u.href);return original.call(this,input,...rest);};
}
syncBuiltinESMExports();
