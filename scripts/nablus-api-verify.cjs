const fs=require('node:fs');
const {matchesSuggestedPlace}=require('../public/customer-mobile/place-search.js');
const read=name=>JSON.parse(fs.readFileSync('.dispatchpro-local/'+name,'utf8').replace(/^\uFEFF/,''));
const base='http://127.0.0.1:9010';
async function request(path,token,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(path+' HTTP '+response.status);return response.json();}
async function login(file){const account=read(file);return (await request('/api/v1/auth/login',null,{tenant:account.tenant,username:account.username||'customer-'+account.accountId.replaceAll('-',''),password:account.password||account.deviceSecret})).accessToken;}
async function main(){
 const result={};
 const manifest=JSON.parse(fs.readFileSync('artifacts/nablus-import/inserted-manifest.json','utf8'));
 for(const [label,file,path] of [['office','office-test-account.json','/api/v1/office/suggested-places'],['driver','driver-field-account.json','/api/v1/driver/places'],['customer','customer-mvp-test-account.json','/api/v1/customer-app/places']]){
  try{const token=await login(file),data=await request(path,token);const rows=Array.isArray(data)?data:data.suggestedPlaces;const proxy=label==='customer'?'/api/customer/places':'/api/reception/'+(label==='driver'?'driver/places':'office/suggested-places');const r=await fetch('http://127.0.0.1:9005'+proxy,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});const value=await r.json(),proxyRows=Array.isArray(value)?value:value.suggestedPlaces;result[label]={count:rows?.length,allIdsAreNew:rows.every(p=>manifest.inserted.some(n=>n.id===p.id)),proxyStatus:r.status,proxyCount:proxyRows?.length,searches:Object.fromEntries(['رف','نجاح','مستشفى','جامعة','بلاطة','عسكر'].map(q=>[q,(proxyRows||[]).filter(p=>matchesSuggestedPlace(p,q)).length])),sample:rows?.slice(0,3)};if(label==='customer'&&r.ok){const {customerMobile}=await import('../tests/helpers/customer-mobile.mjs');const app=await customerMobile({places:value});try{result[label].actualServedScriptSearch={};for(const q of ['رف','نجاح','مستشفى','جامعة','بلاطة','عسكر']){app.nodes.get('pickup-query').value=q;app.nodes.get('pickup-query').oninput();result[label].actualServedScriptSearch[q]=app.nodes.get('pickup-results').children.length;}}finally{app.context.hooks.lock();}}}catch(e){result[label]={error:e.message};}
 }
 const pages={};for(const path of ['/office/suggested-places','/customer-mobile/index.html','/driver-mobile/index.html']){try{const r=await fetch('http://127.0.0.1:9005'+path,{signal:AbortSignal.timeout(30000)});pages[path]=r.status;}catch(e){pages[path]=e.message;}}
 result.pages=pages;
 fs.writeFileSync('artifacts/nablus-import/api-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
