import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('customer shell binds both map pickers and renders accepted driver GPS/ETA with a reused marker',async()=>{
 const html=readFileSync(new URL('../public/customer-mobile/index.html',import.meta.url),'utf8');
 class Element{
  children=[];elements={};style={};value='';hidden=false;disabled=false;isConnected=true;classList={add(){},remove(){}};
  append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}remove(){}querySelectorAll(){return [];}addEventListener(name,fn){this[name]=fn;}
 }
 const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 for(const name of ['register','ride-form'])for(const field of ['tenant','pickup','destination','notes','when','scheduledAt'])nodes.get(name).elements[field]=new Element();
 const maps=[];
 const context={document:{hidden:false,getElementById:id=>nodes.get(id)??null,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener(){}},navigator:{onLine:true},window:{addEventListener(){},isSecureContext:false},location:{href:'https://office.test/customer-mobile/'},localStorage:{getItem:key=>key==='dispatchpro.customer.device.v1'?JSON.stringify({accountId:'test'}):null},URL,AbortController,AbortSignal,console,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),createMap:async(container,point,onPick)=>{const view={container,point,onPick,map:{remove(){},setCenter(){},resize(){}},marker:{positions:[],setLngLat(p){this.positions.push(p);}}};maps.push(view);return view;}};
 vm.createContext(context);
 const source=readFileSync(new URL('../public/customer-mobile/app.js',import.meta.url),'utf8').replace(/^import .*\r?\n/,'');
 vm.runInContext(source+'\nglobalThis.hooks={card,pickLocation,getPoints:()=>({gps,destinationGps})};',context);
 assert.equal(typeof nodes.get('pick-pickup').onclick,'function');assert.equal(typeof nodes.get('pick-destination').onclick,'function');
 await context.hooks.pickLocation('pickup');maps[0].onPick({latitude:32.22,longitude:35.25,locationSource:'MAP_PIN'});
 await context.hooks.pickLocation('destination');maps[1].onPick({latitude:32.23,longitude:35.27,locationSource:'MAP_PIN'});
 assert.equal(context.hooks.getPoints().gps.latitude,32.22);assert.equal(context.hooks.getPoints().destinationGps.longitude,35.27);
 context.navigator.geolocation={getCurrentPosition(ok){ok({coords:{latitude:32.24,longitude:35.28}});}};
 nodes.get('locate').onclick();assert.equal(context.hooks.getPoints().gps.latitude,32.24);assert.equal(nodes.get('locate').disabled,false);
 context.navigator.geolocation={getCurrentPosition(_ok,fail){fail({code:1});}};
 nodes.get('locate').onclick();assert.equal(nodes.get('locate').disabled,false);assert.match(nodes.get('error').textContent,/تعذر تحديد الموقع/);
 const ride={id:'ride',status:'ACCEPTED',createdAt:new Date().toISOString(),pickup:'A',destination:'B',driver:{fullName:'Driver'},tracking:{latitude:32.22,longitude:35.25,etaMinutes:3,updatedAt:new Date().toISOString()}};
 const card=context.hooks.card(ride);assert.ok(card.children.some(n=>n.textContent?.includes('3')));
 context.hooks.card({...ride,tracking:{...ride.tracking,longitude:35.26}});assert.equal(maps.length,2,'Cards do not recreate the shared journey map');
 assert.ok(!card.children.some(n=>n.textContent?.includes('???')));
 for(const [workflowStatus,label] of [['DRIVER_ASSIGNED','تم العثور على سائق'],['DRIVER_ARRIVING','السائق في الطريق إليك'],['DRIVER_ARRIVED','وصل السائق'],['IN_TRIP','الرحلة جارية'],['REJECTED','رفض السائق؛ بانتظار إعادة الإرسال من المكتب']]){
  assert.equal(context.hooks.card({...ride,workflowStatus,tracking:null}).children[0].textContent,label);
 }
});
