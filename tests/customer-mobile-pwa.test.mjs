import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';

test('customer worker installs only existing shell assets and never intercepts customer API or writes',async()=>{
 const events=new Map();let assets;const context={self:{location:{origin:'https://customer.test'},addEventListener:(name,fn)=>events.set(name,fn),clients:{claim:async()=>{}}},caches:{open:async()=>({addAll:async items=>assets=items})},URL,Response,fetch};
 vm.runInNewContext(readFileSync('public/customer-mobile/sw.js','utf8'),context);
 let install;events.get('install')({waitUntil:promise=>install=promise});await install;
 for(const asset of assets)assert.ok(existsSync('public/customer-mobile/'+asset.replace('./','')),asset);
 for(const [method,url]of [['GET','https://customer.test/api/customer/updates'],['POST','https://customer.test/api/customer/rides'],['GET','https://another.test/customer-mobile/app.js'],['POST','https://customer.test/customer-mobile/index.html']])events.get('fetch')({request:{method,url},respondWith(){assert.fail('Authenticated traffic and writes must bypass shell caching');}});
});

test('offline shell reads the active cache version instead of falling back to a mismatched old app version',async()=>{
 const events=new Map(),names=[];const cached=new Response('current-version');const context={self:{location:{origin:'https://customer.test'},addEventListener:(name,fn)=>events.set(name,fn)},caches:{open:async name=>(names.push(name),{match:async()=>cached}),match(){assert.fail('Must not search all old shell versions');}},URL,Response,fetch:async()=>{throw Error('offline');}};
 vm.runInNewContext(readFileSync('public/customer-mobile/sw.js','utf8'),context);
 let response;events.get('fetch')({request:{method:'GET',url:'https://customer.test/customer-mobile/app.js'},respondWith:promise=>response=promise});assert.equal(await (await response).text(),'current-version');assert.deepEqual(names,[readFileSync('public/customer-mobile/sw.js','utf8').match(/const cache='([^']+)'/)[1]]);
});
