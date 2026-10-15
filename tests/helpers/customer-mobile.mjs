import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {createCustomerSession} from '../../public/customer-mobile/session.js';

// Minimal DOM transport harness for the actual served script; no browser/visual claims.
export async function customerMobile({rides=[],places={savedPlaces:[],recentDestinations:[],suggestedPlaces:[]},handlers=new Map(),restoreDevice=true}={}){
  const html=readFileSync(new URL('../../public/customer-mobile/index.html',import.meta.url),'utf8');
  const nodes=new Map(),calls=[],maps=[],timers=[],events=new Map(),logs=[];
  let document;
  class Element{
    children=[];elements={};style={};dataset={};value='';textContent='';hidden=false;disabled=false;open=false;tagName='';
    classList={toggle:(v,on)=>{if(on)this.classList.values.add(v);else this.classList.values.delete(v);},values:new Set(),add:(v)=>this.classList.values.add(v),remove:(v)=>this.classList.values.delete(v)};
    append(...items){for(const item of items){if(item.parentElement)item.parentElement.children=item.parentElement.children.filter(c=>c!==item);item.parentElement=this;this.children.push(item);}}prepend(...items){this.children.unshift(...items);}replaceChildren(...items){this.children=[...items];}remove(){this.removed=true;}setAttribute(key,value){this[key]=value;}removeAttribute(key){delete this[key];}
    addEventListener(type,fn){this[type]=fn;}focus(){document.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;}
    insertBefore(node,before){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(c=>c!==node);node.parentElement=this;const index=this.children.indexOf(before);if(index<0)this.children.push(node);else this.children.splice(index,0,node);}
    getClientRects(){return this.hidden?[]:[{}];}
    querySelectorAll(selector){return [...Object.values(this.elements),...this.children.flatMap(n=>[n,...(n.querySelectorAll?.(selector)||[])])].filter(n=>selector.split(',').some(tag=>n.tagName===tag.trim().toUpperCase()));}
    querySelector(selector){if(selector==='button[type="submit"]')return this.children.find(n=>n.type==='submit')||null;return this.querySelectorAll(selector)[0]||null;}
    reset(){for(const node of Object.values(this.elements))node.value='';}
    requestSubmit(){return this.submit({preventDefault(){},target:this});}reportValidity(){return true;}
  }
  for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element();node.tagName=match[1].toUpperCase();node.hidden=/\bhidden\b/.test(match[0]);node.disabled=/\bdisabled\b/.test(match[0]);nodes.set(match[2],node);}
  for(const match of html.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)){
    const form=nodes.get(match[1]);for(const field of match[2].matchAll(/<(input|select|textarea)\b[^>]*name="([^"]+)"[^>]*>/g)){const id=field[0].match(/id="([^"]+)"/);const node=id?nodes.get(id[1]):new Element();node.tagName=field[1].toUpperCase();form.elements[field[2]]=node;}
    const submit=new Element();submit.tagName='BUTTON';submit.type='submit';form.append(submit);
  }
  nodes.get('ride-form').elements.when.value='now';nodes.get('save-place-form').elements.icon.value='OTHER';
  document={documentElement:{dataset:{}},hidden:false,activeElement:null,getElementById:id=>nodes.get(id),createElement:tag=>{const node=new Element();node.tagName=tag.toUpperCase();return node;},querySelectorAll:selector=>selector==='[data-icon]'?[]:[...nodes.values()].filter(n=>n.tagName==='FORM').flatMap(n=>n.querySelectorAll('button')),addEventListener:(type,fn)=>events.set(type,fn)};
  const storage=new Map(restoreDevice?[['dispatchpro.customer.device.v1',JSON.stringify({tenant:'isolated-office',accountId:randomUUID(),deviceSecret:'test-only-device-secret',registered:true})]]:[]);
  const state={rides,places};
  const context={matchMedia:()=>({matches:false,addEventListener(){}}),document,navigator:{onLine:true},Event,CustomEvent,window:{isSecureContext:false,addEventListener(){},dispatchEvent(){}},location:{href:'http://127.0.0.1:9005/customer-mobile/index.html'},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const [key,node]of Object.entries(this.form.elements))yield[key,node.value];}},crypto:{randomUUID},URL,AbortController,AbortSignal,
    console:{warn:(...args)=>logs.push(args)},requestAnimationFrame:fn=>fn(),setTimeout:(fn,ms)=>(timers.push({fn,ms}),timers.length),clearTimeout(){},
    createJourneyMap:async()=>({map:{remove(){},resize(){}},update(){},fit(){}}),
    createMap:async(container,point,onPick)=>{const view={container,point,onPick,map:{removed:false,remove(){this.removed=true;},resize(){}}};maps.push(view);return view;},
    createCustomerSession:options=>createCustomerSession({...options,fetchImpl:(...args)=>context.fetch(...args)}),
    fetch:async(url,init)=>{
      calls.push({url,init});const route=url.replace('/api/customer/','').split('?')[0],key=init.method+' '+route;
      let result=handlers.has(key)?await handlers.get(key)({url,init,state}):{body:route==='login'?{accessToken:'isolated-customer-token'}:route==='me'?{fullName:'زبون اختبار'}:route==='places'?state.places:route==='updates'?{cursor:randomUUID(),rides:state.rides}:route==='history'?{items:[],total:0}:{id:'created-ride',rideStatus:'SEARCHING_DRIVER'}};
      return{ok:(result.status||200)<400,status:result.status||200,json:async()=>result.body||{}};
    }};
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../../public/customer-mobile/place-search.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../../public/customer-mobile/app.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'')+`\nglobalThis.hooks={startup,watch,lock,card,pickLocation,newRide,loadPlaces,showJourney,notifyArrival,state:()=>({gps,destinationGps,activeRide,rideStateReady,placesData,busy})};`,context);
  const flush=()=>new Promise(setImmediate);
  await context.hooks.startup;await flush();
  const text=node=>[node.textContent,...node.children.map(n=>n&&typeof n==='object'?text(n):n)].join(' ');
  return{nodes,calls,maps,storage,context,state,handlers,timers,events,logs,flush,text,submit:form=>nodes.get(form).submit({preventDefault(){},target:nodes.get(form)})};
}
