import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('customer account opens GPS and submits mapped destination with its own token only',async()=>{
 class Element{
  children=[];elements={};style={};value='';hidden=false;disabled=false;isConnected=true;classList={add(){},remove(){}};
  append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}remove(){}querySelectorAll(){return [];}addEventListener(name,fn){this[name]=fn;}reset(){for(const e of Object.values(this.elements))e.value='';}requestSubmit(){return this.submit({preventDefault(){},target:this});}
 }
 const html=readFileSync(new URL('../public/customer-mobile/index.html',import.meta.url),'utf8');
 const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 for(const form of ['register','ride-form'])for(const field of ['tenant','pickup','destination','notes','when','scheduledAt'])nodes.get(form).elements[field]=new Element();
 const saved=new Map([['dispatchpro.customer.device.v1',JSON.stringify({tenant:'test-office',accountId:'11111111-1111-1111-1111-111111111111',deviceSecret:'test-device',registered:true})]]);
 const calls=[],maps=[];let gpsRequests=0;
 const context={document:{hidden:false,getElementById:id=>nodes.get(id),createElement:()=>new Element(),querySelectorAll:()=>[nodes.get('locate')],addEventListener(){}},
  navigator:{onLine:true,geolocation:{getCurrentPosition(ok){gpsRequests++;ok({coords:{latitude:32.22,longitude:35.25}});}}},
  window:{addEventListener(){},isSecureContext:false},location:{href:'http://127.0.0.1:9005/customer-mobile/?office=test-office'},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
  FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const [key,e]of Object.entries(this.form.elements))yield[key,e.value];}},
  crypto:{randomUUID:()=> '22222222-2222-2222-2222-222222222222'},URL,AbortController,AbortSignal,console,requestAnimationFrame:fn=>fn(),setTimeout:()=>1,clearTimeout(){},
  fetch:async(url,init)=>{calls.push({url,init});if(url.includes('/updates'))return new Promise(()=>{});const data=url.endsWith('/login')?{accessToken:'customer-only-token'}:url.endsWith('/me')?{fullName:'Customer'}:{id:'ride',rideStatus:'SEARCHING_DRIVER'};return{ok:true,json:async()=>data};},
  createJourneyMap:async()=>({map:{remove(){},resize(){}},update(){},fit(){}}),
  createMap:async(container,point,onPick)=>{const view={map:{remove(){}},marker:{},onPick};maps.push(view);return view;}};
 vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../public/customer-mobile/app.js',import.meta.url),'utf8').replace(/^import .*\r?\n/,'')+'\nglobalThis.startupTask=startup;',context);
 await context.startupTask;
 assert.equal(gpsRequests,1,'GPS must start even while login form buttons are busy');
 assert.equal(nodes.get('ride-form').elements.pickup.value,'موقعي الحالي');
 await nodes.get('pick-destination').onclick();
 // The event handler deliberately returns void; flush the map creation promise.
 await Promise.resolve();
 maps[0].onPick({latitude:32.23,longitude:35.27,locationSource:'MAP_PIN'});
 await nodes.get('ride-form').submit({preventDefault(){},target:nodes.get('ride-form')});
 assert.equal(calls.filter(c=>c.url.endsWith('/rides')).length,0,'Review does not submit a ride');
 assert.equal(nodes.get('ride-summary').hidden,false);
 assert.ok(nodes.get('summary-details').children.some(n=>n.textContent.includes('المسافة المباشرة')));
 await nodes.get('confirm-ride').onclick();
 const request=calls.find(c=>c.url.endsWith('/rides'));
 assert.ok(request);assert.equal(request.init.headers.Authorization,'Bearer customer-only-token');
 const body=JSON.parse(request.init.body);
 assert.equal(body.pickup.locationSource,'CUSTOMER_GPS');assert.equal(body.pickup.latitude,32.22);assert.equal(body.destinationLocation.longitude,35.27);
 assert.ok(calls.every(c=>c.url.startsWith('/api/customer/')),'No Office API login or office request');
 nodes.get('ride-form').elements.pickup.oninput();
 await nodes.get('ride-form').submit({preventDefault(){},target:nodes.get('ride-form')});
 assert.equal(calls.filter(c=>c.url.endsWith('/rides')).length,1,'Missing pickup coordinates cannot silently enter automatic search');
 await nodes.get('confirm-ride').onclick();
 assert.equal(calls.filter(c=>c.url.endsWith('/rides')).length,1,'Repeated confirm is blocked before the first live snapshot arrives');
 assert.equal(nodes.get('journey-status').hidden,false);
 assert.match(nodes.get('journey-status').textContent,/البحث/);
});
