// Headless integration of the existing component. No preview page/server is created.
// Every browser URL is fulfilled from memory or aborted; never route.continue().
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import {PNG} from 'pngjs';
import {chromium} from '../artifacts/maps-reception-20261006/browser-tools/node_modules/playwright/index.mjs';
import {digitGlyphs} from './helpers/map-digit-glyphs.mjs';
const root=process.cwd(),out='artifacts/maps-current-integration-20261015',origin='http://dispatchpro.local.test';
const api=await readFile('tests/helpers/map-browser-fixture.mjs','utf8');
const modules={
 'test-api':api,
 'test-office':`export const useOffice=()=>({tenant:'local-test'});`,
 'test-traccar':`import{api}from'test-api';const devices=api.data.drivers.map((d,i)=>({id:i+1,name:d.fullName,status:d.status==='Offline'?'offline':'online',disabled:false}));const positions=api.data.drivers.map((d,i)=>({id:i+1,deviceId:i+1,valid:true,outdated:d.locationStatus==='STALE',latitude:d.location.latitude,longitude:d.location.longitude,accuracy:d.location.accuracy,fixTime:d.location.updatedAt}));export const useTraccar=()=>({devices,positions,loading:false,authenticated:true,login:async()=>{},refreshData:async()=>{window.testRefreshes=(window.testRefreshes||0)+1},getOnlineDevices:()=>devices.filter(d=>d.status==='online')});`,
 'test-link':`export default 'a';`,
 'test-dynamic':`export default ()=>()=>null;`,
 'test-voice':`export {PttButton} from ${JSON.stringify(path.join(root,'src/components/ptt-control.tsx'))};const client={start:async()=>{},stop:()=>{},unlock:()=>{},prepareMicrophone:async()=>{},releaseMicrophone:()=>{}};const status={connected:true,message:'بيانات اختبار محلية',needsPlayback:false,talking:null,state:{self:{actorId:'test-office',office:true},access:{voiceEnabled:true,canTalkPublic:true,canTalkPrivate:true},peers:[],floors:[],publicMuted:false}};export const useVoice=()=>({client,status});`,
 'test-map':`import React,{forwardRef}from'react';import RealMap from'real-map';export{Source,Layer,Marker,Popup,NavigationControl,AttributionControl,useMap}from'real-map';export default forwardRef((props,ref)=><RealMap {...props} ref={value=>{if(value)window.testMap=value.getMap();if(typeof ref==='function')ref(value);else if(ref)ref.current=value;}} onLoad={event=>{window.testMap=event.target;for(const id of ['office-taxis','office-selected-taxi']){const source=event.target.getSource(id);if(source){const update=source.updateData.bind(source);source.updateData=diff=>{window.testDiffs??=[];window.testDiffs.push(diff);return update(diff)}}}props.onLoad?.(event)}}/>);`
};
const bundle=await build({absWorkingDir:root,stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{OfficeDriverMap}from'./src/components/office-driver-map';import{TraccarMapView}from'./src/components/TraccarMapView';import{MapView}from'./src/components/map-view';import{api}from'test-api';window.testApi=api;createRoot(document.getElementById('app')).render(location.search.includes('legacy')?<MapView drivers={api.data.drivers.map(d=>({id:d.id,name:d.fullName,status:'available',location:{x:d.location.latitude,y:d.location.longitude}}))} rides={[]}/>:location.search.includes('fleet')?<TraccarMapView mode="custom" height="100dvh"/>:<OfficeDriverMap/>);`,resolveDir:root,loader:'tsx'},outfile:'app.js',write:false,bundle:true,platform:'browser',target:'chrome120',jsx:'automatic',alias:{'@':path.join(root,'src')},define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_MAPBOX_ENABLED':'"true"','process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN':'"pk.browser.fixture"'},plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/^test-/},a=>({path:a.path,namespace:'test'}));
 b.onResolve({filter:/reception-api$/},()=>({path:'test-api',namespace:'test'}));
 b.onResolve({filter:/^\.\/ptt-control$/},()=>({path:'test-voice',namespace:'test'}));
 b.onResolve({filter:/traccar-context$/},()=>({path:'test-traccar',namespace:'test'}));
 b.onResolve({filter:/office-workspace$/},()=>({path:'test-office',namespace:'test'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'test-link',namespace:'test'}));
 b.onResolve({filter:/^next\/dynamic$/},()=>({path:'test-dynamic',namespace:'test'}));
 b.onResolve({filter:/^react-map-gl\/maplibre$/},()=>({path:'test-map',namespace:'test'}));
 b.onResolve({filter:/^real-map$/},()=>({path:path.join(root,'node_modules/react-map-gl/dist/esm/exports-maplibre.js')}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:modules[a.path],loader:'tsx',resolveDir:root}));
}}]});
const js=Buffer.from(bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents),css=Buffer.from(bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.contents??[]);
const theme=(await postcss([tailwind({content:['src/components/**/*.tsx'],theme:{extend:{}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css+'html,body,#app{height:100%;margin:0;font-family:Tahoma,Arial}';
const style={version:8,sources:{composite:{type:'vector',url:'mapbox://mapbox.mapbox-streets-v8'}},layers:[{id:'land',type:'background',paint:{'background-color':'#e2e8f0'}},{id:'road',type:'line',source:'composite','source-layer':'road'}]};
const png=new PNG({width:32,height:32});png.data.fill(90);const image=PNG.sync.write(png),glyphs=Buffer.from(digitGlyphs());
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--host-resolver-rules=MAP * ~NOTFOUND'],proxy:{server:'http://127.0.0.1:9'}});
let lastPage;
const result={handled:[],status:'running',component:'src/components/office-driver-map.tsx',providerCodeMocked:false,mapboxStyleHookMocked:false,productionApiMocked:true,realMapboxRequests:0,realGps:false,tests:[],blocked:[],errors:[]};
try{
 for(const [width,height,view] of [[320,640,'office'],[393,852,'office'],[640,360,'office'],[1366,900,'office'],[360,740,'fleet'],[1366,900,'fleet'],[320,640,'legacy'],[1366,900,'legacy']]){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage();let styleLoads=0;
  lastPage=page;page.on('console',message=>{if(message.type()==='error')result.errors.push(message.text().slice(0,500));});page.setDefaultTimeout(15000);page.on('pageerror',error=>result.errors.push(error.message));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url()),pathname=u.pathname;result.handled.push(u.origin+pathname);
   const reply=(contentType,body)=>route.fulfill({status:200,contentType,body});
   if(u.origin===origin){
    if(pathname==='/')return reply('text/html','<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
    if(pathname==='/app.js')return reply('text/javascript',js);
    if(pathname==='/app.css')return reply('text/css',css);
    if(pathname==='/theme.css')return reply('text/css',theme);
    if(pathname==='/mapbox-logo.svg')return reply('image/svg+xml',await readFile('public/mapbox-logo.svg'));
    if(pathname==='/mapbox-gl-rtl-text-0.2.3.min.js')return reply('text/javascript',await readFile('public/mapbox-gl-rtl-text-0.2.3.min.js'));
   }
   if(u.origin==='https://api.mapbox.com'){
    if(pathname==='/styles/v1/mapbox/streets-v12'){styleLoads++;return reply('application/json',JSON.stringify(style));}
    if(pathname.includes('/fonts/'))return reply('application/x-protobuf',pathname.endsWith('/0-255.pbf')?glyphs:Buffer.from([10,0]));
    if(pathname.includes('/sprite'))return pathname.endsWith('.json')?reply('application/json','{}'):reply('image/png',image);
    if(pathname.includes('/satellite-v9/tiles/'))return reply('image/png',image);
    if(pathname.startsWith('/v4/'))return reply('application/x-protobuf',Buffer.alloc(0));
   }
   result.blocked.push(u.origin+pathname);await route.abort();
  });
  await page.goto(origin+(view==='office'?'':'/?'+view+'=1'),{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>window.testMap?.isStyleLoaded());
  const credits=async()=>{
   await page.waitForTimeout(160);
   return page.evaluate(()=>{const rail=document.querySelector('[data-map-legal]')??document.querySelector('footer'),box=rail.getBoundingClientRect(),work=(document.querySelector('[data-map-workspace]')??document.querySelector('canvas')).getBoundingClientRect();const visible=selector=>{const el=rail.querySelector(selector),r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.height>0&&r.bottom<=innerHeight&&(top===el||el.contains(top));};return {logo:visible('a[aria-label="Mapbox"]'),attribution:visible('.maplibregl-ctrl-attrib-inner'),separate:work.bottom<=box.top+1,overflow:document.documentElement.scrollWidth>innerWidth,text:rail.textContent};});
  };
  if(view==='legacy'){
   const rail=page.locator('footer');await rail.getByRole('link',{name:'Mapbox',exact:true}).waitFor();await page.waitForTimeout(250);
   const legal=await credits();assert.equal(legal.logo,true);assert.equal(legal.attribution,true);assert.equal(legal.overflow,false);assert.match(await page.locator('[role="status"]').innerText(),/وقت تحديث GPS غير متاح/);
   result.tests.push({view,width,height,legacyCoordinates:true,legalVisible:true});await context.close();continue;
  }
  if(view==='fleet'){
   const rail=page.locator('footer');await rail.getByRole('link',{name:'Mapbox',exact:true}).waitFor();
   await page.getByRole('button',{name:'Refresh',exact:true}).click();assert.equal(await page.evaluate(()=>window.testRefreshes),1);
   await page.locator('summary').filter({hasText:'طبقات الخريطة'}).click();await page.getByRole('button',{name:'أقمار صناعية مع أسماء',exact:true}).click();await page.waitForFunction(()=>window.testMap.getLayoutProperty('dispatch-mapbox-satellite','visibility')==='visible');await page.waitForFunction(()=>document.querySelector('footer').textContent.includes('Maxar'));
   await page.getByRole('button',{name:'شوارع Mapbox',exact:true}).click();assert.equal(styleLoads,1);await page.locator('summary').filter({hasText:'طبقات الخريطة'}).click();
   await page.evaluate(()=>window.testMap.jumpTo({zoom:16}));await page.waitForTimeout(500);
   const point=await page.evaluate(()=>{const r=document.querySelector('canvas').getBoundingClientRect(),p=window.testMap.project([35.2544,32.2211]);return {x:r.left+p.x,y:r.top+p.y}});await page.mouse.click(point.x,point.y);await page.locator('.maplibregl-popup').waitFor();assert.match(await page.locator('.maplibregl-popup').innerText(),/سائق اختبار 56/);
   assert.equal(await rail.evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   result.tests.push({view,width,height,currentTraccarContext:true,refresh:true,satelliteSwitch:true,cachedStyleRequests:styleLoads,selection:true,legalVisible:true});await context.close();continue;
  }
  await page.getByRole('button',{name:'قائمة السائقين',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'لوحة السائقين',exact:true});await panel.getByRole('searchbox',{name:'ابحث عن سائق',exact:true}).fill('QA-155');assert.equal(await panel.locator('[data-driver-card]').count(),1);
  const legal=await credits();assert.equal(legal.logo,true);assert.equal(legal.attribution,true);assert.equal(legal.separate,true);assert.equal(legal.overflow,false);
  await panel.getByRole('searchbox',{name:'ابحث عن سائق',exact:true}).fill('');await panel.getByLabel('فتح فلاتر السائقين',{exact:true}).click();await panel.getByLabel('تصفية جودة GPS',{exact:true}).selectOption('Poor');assert.equal(await panel.locator('[data-driver-card]').count(),1);
  await panel.getByRole('button',{name:'إغلاق لوحة السائقين',exact:true}).click();await page.getByRole('button',{name:'طبقات الخريطة',exact:true}).click();await page.getByRole('button',{name:'أقمار صناعية مع أسماء',exact:true}).click();await page.waitForFunction(()=>window.testMap.getLayoutProperty('dispatch-mapbox-satellite','visibility')==='visible');
  const sat=await credits();assert.match(sat.text,/Maxar/);assert.equal(sat.logo,true);assert.equal(sat.attribution,true);
  await page.getByRole('button',{name:'شوارع Mapbox',exact:true}).click();await page.waitForFunction(()=>window.testMap.getLayoutProperty('dispatch-mapbox-satellite','visibility')==='none');assert.equal(styleLoads,1);
  await page.getByRole('button',{name:'طبقات الخريطة',exact:true}).click();await page.getByRole('button',{name:'فتح بحث السائقين',exact:true}).click();await page.getByRole('searchbox',{name:'ابحث عن سائق',exact:true}).fill('QA-155');await page.getByRole('button',{name:'نتيجة بحث سائق اختبار 56',exact:true}).click();await page.getByRole('complementary',{name:'معلومات السائق المحدد',exact:true}).waitFor();
  await page.evaluate(()=>window.testApi.update());await page.waitForTimeout(800);assert.ok(await page.evaluate(()=>window.testDiffs.some(diff=>diff.update?.some(item=>item.id==='qa-1'))));assert.equal(await page.locator('[aria-label="معلومات السائق المحدد"]').count(),1);
  await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('Escape');
  await page.screenshot({path:out+`/component-${width}x${height}.png`});
  result.tests.push({view,width,height,search:true,gpsFilter:true,legal,satelliteSwitch:true,cachedStyleRequests:styleLoads,selection:true,incrementalGps:true,reducedMotion:true});await context.close();
 }
 assert.deepEqual(result.blocked,[]);assert.deepEqual(result.errors,[]);result.status='passed';
}catch(error){result.status='failed';result.failure=error.stack;if(lastPage){result.diagnostics=await lastPage.evaluate(()=>({body:document.body.innerText.slice(0,700),map:!!window.testMap,api:!!window.testApi,canvases:document.querySelectorAll('canvas').length,scripts:document.scripts.length,loaded:window.testMap?.isStyleLoaded(),tiles:window.testMap?.areTilesLoaded(),style:window.testMap?.getStyle()?.layers.map(l=>l.id),sourceStates:window.testMap?Object.fromEntries(Object.entries(window.testMap.style.sourceCaches).map(([id,s])=>[id,{loaded:s.loaded(),tiles:Object.keys(s._tiles).length}])):{}})).catch(()=>({}));await lastPage.screenshot({path:out+'/browser-failure.png'}).catch(()=>{});}process.exitCode=1;}
finally{await writeFile(out+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();}
