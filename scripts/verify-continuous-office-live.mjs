import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createApiReceptionBackend} from '../src/lib/reception-api.ts';
const origin='https://office.nablustaxi.com';
const credentials=JSON.parse((await readFile('.dispatchpro-local/office-test-account.json','utf8')).replace(/^\uFEFF/,''));
const cookies=new Map(),requests=[];let online=true;
function storage(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
globalThis.window={location:new URL(origin),localStorage:storage(),sessionStorage:storage(),addEventListener:()=>{}};
const transport=async(path,init={})=>{
 if(!online)throw Error('simulated offline');
 const response=await fetch(origin+path,{...init,headers:{...init.headers,Origin:origin,...(cookies.size?{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})}});
 for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],i=first.indexOf('=');const key=first.slice(0,i),value=first.slice(i+1);if(!value||/Max-Age=0(?:;|$)/i.test(cookie))cookies.delete(key);else cookies.set(key,value);}
 requests.push({path,method:init.method||'GET',status:response.status});return response;
};
const home=await fetch(origin+'/office/reception');assert.equal(home.status,200);
const html=await home.text();
const scripts=[...html.matchAll(/src="([^" ]+\.js)"/g)].map(m=>m[1]);
const code=(await Promise.all(scripts.map(async p=>(await fetch(origin+p)).text()))).join('\n');
assert.ok(code.includes('إرسال بدون رقم الهاتف'),'Reception privacy dialog must be in deployed JS');
assert.ok(code.includes('dispatchpro.office.renewable'),'renewal client must be in deployed JS');
const first=createApiReceptionBackend(transport,true);await first.login(credentials.tenant,credentials.username,credentials.password);await first.office();
assert.ok(cookies.has('dispatchpro.office.refresh'));assert.ok(first.authSnapshot().authenticated);
const oldNow=Date.now;
try{const real=oldNow();Date.now=()=>real+31*60000;await first.office();assert.ok(first.authSnapshot().authenticated);}finally{Date.now=oldNow;}
const reload=createApiReceptionBackend(transport,true);await reload.bootstrap();await reload.office();assert.ok(reload.session());
// Browser reopening retains cookies/local identity but receives a new sessionStorage.
globalThis.window.sessionStorage=storage();const reopened=createApiReceptionBackend(transport,true);await reopened.bootstrap();await reopened.office();assert.ok(reopened.authSnapshot().authenticated);
online=false;
try{const real=oldNow();Date.now=()=>real+24*3600000;await assert.rejects(reopened.office(),e=>!e.sessionInvalid);assert.ok(reopened.authSnapshot().authenticated);}finally{Date.now=oldNow;}
globalThis.window.sessionStorage=storage();const offlineReopened=createApiReceptionBackend(transport,true);await offlineReopened.bootstrap();assert.ok(offlineReopened.authSnapshot().authenticated);
online=true;await offlineReopened.office();assert.ok(offlineReopened.session());
// Revokes only this synthetic verification session, never the employee's browser session.
const logout=await transport('/api/reception/auth/session',{method:'DELETE'});assert.equal(logout.status,204);
const revoked=await transport('/api/reception/auth/session',{method:'POST'});assert.equal(revoked.status,401);
for(const api of [first,reload,reopened,offlineReopened])api.logout();
await writeFile('artifacts/reception-continuous-session/live-check.json',JSON.stringify({origin,reception:home.status,deployedReception:true,renewal:true,expiryRenewal:true,reload:true,browserReopen:true,offlineRecovery:true,logoutRevoked:true,requests,checkedAt:new Date().toISOString()},null,2));
console.log('LIVE: Reception assets, renewable HttpOnly session, expiry-triggered renewal, reload, browser reopen, simulated offline/recovery, logout: PASS');
