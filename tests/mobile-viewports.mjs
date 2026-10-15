// Optional browser runner: use an already installed Playwright; never downloads browsers.
// PLAYWRIGHT_MODULE may be a file URL; MOBILE_BROWSER=webkit runs the same checks in WebKit.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.MOBILE_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,...(process.env.MOBILE_BROWSER==='webkit'?{}:{channel:process.env.MOBILE_CHANNEL||'msedge'})});
const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const server=createServer(async(req,res)=>{
 try{const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(root,'.'+requested);if(!target.startsWith(root+path.sep))throw Error('path');const data=await readFile(target);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json'})[path.extname(target)]||'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let checks=0;
try{
 for(const viewport of [{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:430,height:932},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block',geolocation:{latitude:32.22,longitude:35.25},permissions:['geolocation']});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/maps.js',r=>r.fulfill({contentType:'text/javascript',body:'export async function createJourneyMap(){return {map:{remove(){},resize(){}},update(){},fit(){}}} export async function createMap(){return {map:{remove(){},resize(){}}}}'}));
  // Simulate Safari before static abort helpers; normal APIs and touch behavior remain real.
  await page.addInitScript(()=>{AbortSignal.any=undefined;AbortSignal.timeout=undefined;});
  await page.route('**/api/customer/**',r=>{
   const url=r.request().url();return r.fulfill({json:url.endsWith('/register')?{accessToken:'test'}:url.endsWith('/me')?{fullName:'زبون تجربة طويل الاسم'}:url.includes('/updates')?{cursor:'one',rides:[]}:{}});
  });
  await page.goto(origin+'/customer-mobile/index.html');
  await page.locator('[name=tenant]').fill('test');await page.locator('[name=fullName]').fill('زبون اختبار');await page.locator('[name=phone]').fill('٠٥٩١٢٣٤٥٦٧');
  await page.locator('#register button').tap();await page.locator('#account').waitFor({state:'visible'});
  await page.locator('#open-destination').tap();await page.locator('#destination-query').fill('عنوان طويل لاختبار التفاف النص على شاشة الهاتف الصغيرة');await page.locator('#use-destination-text').tap();
  await page.locator('[name=pickup]').fill('نابلس');
  await page.locator('#request-ride').tap();await page.locator('#ride-summary').waitFor({state:'visible'});
  await layout(page,'customer',viewport);checks++;
  await page.route('**/api/reception/**',r=>{
   const url=r.request().url();const profile={id:'driver',fullName:'سائق اختبار',status:'Available'};
   return r.fulfill({json:url.endsWith('/auth/login')?{accessToken:'test'}:url.endsWith('/driver/me')?profile:url.includes('/updates')?{cursor:'one',serverTime:new Date().toISOString(),data:{driver:profile,rides:[{id:'ride',version:1,status:'Assigned',pickup:'نقطة انطلاق طويلة لاختبار عرض الرحلة',destination:'الجامعة',offerExpiresAt:new Date(Date.now()+30000).toISOString()}],jobs:[{id:'job',rideId:'queued',position:1,pickup:'طلب منتظر',destination:'نابلس'}],notices:[]}}:{stored:true}});
  });
  await page.goto(origin+'/driver-mobile/index.html');
  await page.getByLabel('معرف المكتب').fill('test');await page.getByLabel('اسم المستخدم').fill('driver');await page.getByLabel('كلمة المرور').fill('test');await page.getByRole('button',{name:'دخول',exact:true}).tap();
  await page.getByRole('button',{name:'قبول',exact:true}).waitFor();
  await page.getByText('طلب منتظر',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'قبول',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'رفض',exact:true}).isEnabled(),true);
  await layout(page,'driver',viewport);checks++;
  assert.deepEqual(errors,[],`runtime errors at ${viewport.width}`);await context.close();
 }
 console.log(`PASS: ${checks} mobile viewport checks (${engine.name()}, touch + RTL + login + customer review + driver offer/queue; mocked API/maps).`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

async function layout(page,app,viewport){
 const measured=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,rtl:getComputedStyle(document.querySelector('main')).direction,smallTargets:[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().height>0&&e.getBoundingClientRect().height<44).map(e=>e.textContent)}));
 assert.ok(measured.scroll<=measured.width+1,`${app} overflow at ${viewport.width}: ${JSON.stringify(measured)}`);
 assert.equal(measured.rtl,'rtl');assert.deepEqual(measured.smallTargets,[],`${app} touch targets at ${viewport.width}`);
}
