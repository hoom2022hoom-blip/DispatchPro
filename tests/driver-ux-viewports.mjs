import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// A local UI fixture only. No live credentials, live orders, GPS or audio.
const output=path.resolve(process.argv[2]??'artifacts/driver-ux-qa-20261012');
await mkdir(output,{recursive:true});
const toolsPath=process.env.DISPATCHPRO_QA_PLAYWRIGHT??path.resolve('artifacts/maps-reception-20261006/browser-tools/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(toolsPath).href);
const apiFixture=`
let version=1,status='Assigned';
const now=Date.parse('2026-10-12T15:00:00Z');
const profile=()=>({id:'qa-driver',fullName:'سائق اختبار معزول',status:status==='Completed'?'Available':'Busy',gpsEnabled:false});
const ride=()=>({id:'qa-ride',version,status,pickup:'نقطة انطلاق اختبارية طويلة للتأكد من التفاف العنوان ووضوحه للسائق',destination:'وجهة اختبارية عامة لا ترتبط بأي طلب تشغيل',fullName:status==='Assigned'?undefined:'زبون اختبار',phone:status==='Assigned'?undefined:'TEST-ONLY',finalFare:25,currency:'ILS',offerDistanceMeters:1600,offerEtaSeconds:150,offerExpiresAt:new Date(now+30000).toISOString(),fareMode:'OFFICE_MANUAL'});
window.qaState=next=>{status=next;version++;window.dispatchEvent(new Event('online'));};
window.dispatchProDriverNative=true;window.dispatchProDriverAppVersion='5.1.6-qa.6';window.dispatchProDriverQa=${process.argv.includes('--qa-audio')};
window.dispatchProDriverDiagnostics={read:async()=>({notifications:true,channel:true,sound:true,locationPermission:true,gpsEnabled:false,gpsAt:0,preciseLocation:true,backgroundLocation:false,service:true,locationForegroundService:true,fcmConfigured:true,fcmRegistered:true,microphone:true}),settings:async()=>{}};
export class DriverApiError extends Error{}
export const noticeLabel=()=>'';
const api={bootstrap:async()=>profile(),sessionIdentity:()=>({tenant:'qa-only'}),authenticated:()=>true,offerNow:()=>now,
 updates:async(cursor,signal)=>{if(cursor)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));return {cursor:String(version),data:{driver:profile(),rides:status==='Completed'?[]:[ride()],jobs:[],notices:[]}};},
 ride:async()=>ride(),voice:async()=>({}),transition:async(r,next)=>{status=next;version++;return ride();},reject:async()=>{status='Completed';version++;},availability:async()=>{},pendingCount:()=>0,logout:()=>{},places:async()=>[],history:async()=>({items:[],total:0}),earnings:async()=>({items:[],summary:{totals:[]}})};
export const createDriverApi=()=>api;`;
const voiceFixture=`
const clients=new Set();
window.qaVoice=(ready)=>{for(const c of clients){c.ready=ready;c.emit();}};
export class VoiceClient{
 constructor(request,onStatus){this.onStatus=onStatus;this.ready=false;clients.add(this);}
 emit(){this.onStatus({connected:true,message:'المخشيرة متصلة — اختبار فقط',talking:null,needsPlayback:false,microphoneReady:this.ready,state:{access:{voiceEnabled:true,isVoiceBlocked:false,canTalkPublic:true,canTalkPrivate:true},self:{driverId:'qa-driver',office:false},publicMuted:false}});}
 connect(){this.emit();}requirePreparation(){}automaticMicrophone(){}stop(){}unlock(){}networkChanged(){}setAudioAvailable(){}suspendForCall(){}resumeAfterCall(){}start(){}isHolding(){return false;}
 prepareMicrophone(){this.ready=true;this.emit();}releaseMicrophone(){this.ready=false;this.emit();}dispose(){clients.delete(this);}
}`;
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{DriverApiDashboard}from'./src/components/driver-api-dashboard';createRoot(document.getElementById('app')).render(React.createElement(DriverApiDashboard));",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:path.join(output,'qa-ui.js'),platform:'browser',jsx:'automatic',target:'chrome100',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':path.resolve('src'),'@/lib/notifications':path.resolve('driver-android/web/notifications.ts')},plugins:[{name:'isolated-fixtures',setup(b){b.onResolve({filter:/^@\/lib\/(driver-api|voice-client)$/},a=>({path:a.path,namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:a.path.endsWith('driver-api')?apiFixture:voiceFixture,loader:'js'}));}}]});
const css=await readFile(path.join(output,'qa-assets/app.css'));
const logo=await readFile('public/customer-mobile/office-logo.webp');
const fakeMap=`export async function createJourneyMap(container){container.textContent='خريطة اختبار معزولة';container.style.display='grid';container.style.placeItems='center';container.style.background='#dce8d7';return{map:{remove(){},resize(){}},update(){},fit(){}}}`;
const server=createServer((req,res)=>{
 const route=new URL(req.url,'http://localhost').pathname;
 const files={'/':['text/html','<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="app"></div><script src="/app.js"></script></html>'],'/app.js':['text/javascript',bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents],'/app.css':['text/css',css],'/customer-mobile/office-logo.webp':['image/webp',logo],'/driver-mobile/maps.js':['text/javascript',fakeMap]};
 const value=files[route];if(!value){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',value[0]);res.end(value[1]);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={mode:'isolated mocked UI; not physical-device acceptance',checks:[],externalRequests:[],errors:[]};
try{
 const viewports=process.argv.includes('--qa-audio')?[{width:393,height:873,deviceScaleFactor:2.75},{width:320,height:568},{width:430,height:932}]:[{width:393,height:800,deviceScaleFactor:2.75},{width:320,height:568},{width:375,height:667},{width:430,height:932},{width:800,height:360}];
 for(const viewport of viewports){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:viewport.deviceScaleFactor??1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/*',r=>{if(r.request().url().startsWith(origin+'/'))return r.continue();report.externalRequests.push(new URL(r.request().url()).hostname);return r.abort();});
  await page.goto(origin);await page.getByRole('button',{name:'قبول',exact:true}).waitFor();
  await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--driver-voice-height'))>0);
  for(const prepared of [false,true]){
   await page.evaluate(value=>window.qaVoice(value),prepared);
   for(const state of ['Assigned','Accepted','DriverArriving','Arrived','InProgress','Completed']){
    await page.evaluate(value=>window.qaState(value),state);
    if(state==='Completed')await page.getByRole('button',{name:'متاح',exact:true}).waitFor();else await page.locator('.driver-action-dock').waitFor();
    // Wait for the corresponding render and layout, including ResizeObserver.
    await page.waitForFunction(s=>s==='Completed'?!document.querySelector('.driver-action-dock'):document.querySelector('.driver-action-dock button')?.textContent==={Assigned:'قبول',Accepted:'في الطريق إلى الزبون',DriverArriving:'وصلت للزبون',Arrived:'بدء الرحلة',InProgress:'إنهاء الرحلة'}[s],state);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const metrics=await page.evaluate(()=>{
     const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const b=e.getBoundingClientRect();return{top:b.top,bottom:b.bottom,height:b.height,left:b.left,right:b.right};};
     return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,rtl:getComputedStyle(document.querySelector('main')).direction,voice:rect('.driver-voice-bar'),dock:rect('.driver-action-dock'),content:rect('.driver-workspace'),fare:rect('.driver-action-dock .trip-fare'),buttons:[...document.querySelectorAll('.driver-action-dock button,.driver-voice-bar button[aria-pressed]')].map(e=>({label:e.textContent,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}))};
    });
    assert.equal(metrics.width,viewport.width);assert.equal(metrics.height,viewport.height);assert.ok(metrics.scrollWidth<=metrics.width+1,JSON.stringify(metrics));assert.equal(metrics.rtl,'rtl');assert.ok(Math.abs(metrics.voice.bottom-metrics.height)<1,'PTT must stay at bottom');
    if(metrics.dock){assert.ok(metrics.content.bottom<=metrics.dock.top+1,'content must stop above actions');assert.ok(metrics.dock.bottom<=metrics.voice.top+1,'actions must stop above PTT');assert.ok(metrics.fare.top>=0&&metrics.fare.bottom<=metrics.voice.top+1,'fare must stay visible');}
    else assert.ok(metrics.content.bottom<=metrics.voice.top+1,'other screens must reserve PTT space');
    assert.ok(metrics.buttons.every(b=>b.height>=48&&b.width>=48),'touch targets');
    report.checks.push({viewport,state,prepared,metrics});
    if(state==='Assigned'&&!prepared){const offer=await page.locator('[aria-label="تفاصيل الطلب قبل القبول"]').innerText();assert.match(offer,/الاسم غير متاح قبل القبول/);assert.match(offer,/3 دقيقة/);assert.doesNotMatch(offer,/TEST-ONLY/);await page.screenshot({path:path.join(output,`offer-${viewport.width}x${viewport.height}.png`)});}
    if(state==='Arrived'&&prepared)await page.screenshot({path:path.join(output,`arrived-${viewport.width}x${viewport.height}.png`)});
   }
  }
  await page.getByRole('button',{name:'إعدادات السائق'}).click();await page.getByText('إصدار التطبيق: 5.1.6-qa.6',{exact:true}).waitFor();
  await page.evaluate(()=>document.documentElement.dataset.taxiTheme='dark');
  await page.getByRole('button',{name:'عودة للخريطة',exact:true}).click();await page.evaluate(()=>window.qaState('Assigned'));
  await page.getByRole('button',{name:'قبول',exact:true}).waitFor();await page.screenshot({path:path.join(output,`dark-${viewport.width}x${viewport.height}.png`)});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(output,'viewport-results.json'),JSON.stringify(report,null,2));
 console.log(`PASS: ${report.checks.length} state/viewport/PTT checks; isolated fixture only.`);
}catch(error){report.failure=error.message;await writeFile(path.join(output,'viewport-results.json'),JSON.stringify(report,null,2));throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
