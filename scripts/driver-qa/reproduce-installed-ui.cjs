const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const fixture=JSON.parse(fs.readFileSync(path.join(out,'private/qa-unpriced-ride.json'),'utf8'));
const current=process.argv.includes('--current'),finish=process.argv.includes('--finish');
const assetsArgument=process.argv.find(x=>x.startsWith('--assets='));
const assets=assetsArgument?path.resolve(assetsArgument.slice(9)):c.qaAssets;
const report={at:new Date().toISOString(),mode:current?'current-source-ui':'exact-installed-5.1.5-assets',physicalDevice:false,qaOnly:true,traces:[],requests:[],consoleErrors:[]};
const controllers=new Map();
(async()=>{
 const {chromium}=await import(pathToFileURL(path.resolve('artifacts/maps-reception-20261006/browser-tools/node_modules/playwright/index.mjs')).href);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:800},isMobile:true,hasTouch:true,deviceScaleFactor:2.75});
  const page=await context.newPage();page.on('pageerror',e=>report.consoleErrors.push(e.message));
  const env=await fetch(c.publicOrigin+'/qa/status').then(r=>r.json());assert.equal(env.environment,'DriverQa');assert.equal(env.database,c.database);
  const profile=await fetch(c.publicOrigin+'/api/v1/driver/me',{headers:{Authorization:'Bearer '+fixture.driverToken}}).then(r=>r.json());assert.equal(profile.id,c.driverId);
  let saved=JSON.stringify({token:fixture.driverToken,tenant:c.tenant,profile});
  await page.exposeFunction('qaNative',async call=>{
   if(call.type==='ready')return {apiOrigin:c.publicOrigin,appVersion:current?'5.1.6-qa.2':'5.1.5',notifications:false,online:true,foreground:true};
   if(call.type==='session.load')return saved;
   if(call.type==='session.save'){saved=call.value;return true;}
   if(call.type==='diagnostics.runtime'){report.traces.push(call);return true;}
   if(call.type==='external.status')return {owner:'driver'};
   if(call.type==='cancel'){controllers.get(call.id)?.abort();return true;}
   if(call.type!=='request')return false;
   if(call.path.startsWith('voice/'))return {status:403,body:'{}'}; // No microphone, media, calls or voice sessions.
   if(call.method!=='GET'&&!(call.method==='PUT'&&[`rides/${fixture.ride.id}/status`,`rides/${fixture.ride.id}/locations`,`driver/rides/${fixture.ride.id}/reject`].includes(call.path)))return {status:403,body:'{}'};
   const controller=new AbortController();controllers.set(call.id,controller);
   try{
    const r=await fetch(c.publicOrigin+'/api/v1/'+call.path,{method:call.method,headers:{Authorization:call.authorization,'Content-Type':'application/json'},body:call.body||undefined,signal:controller.signal});
    const body=await r.text();const entry={path:call.path.split('?')[0].replace(fixture.ride.id,'QA_RIDE'),method:call.method,http:r.status,...(call.path.endsWith('/status')?{transition:JSON.parse(call.body).status}:{} )};
    if(entry.transition&&r.ok){const snap=await fetch(c.publicOrigin+'/api/v1/reception/snapshot',{headers:{Authorization:'Bearer '+fixture.officeToken}}).then(r=>r.json());const row=snap.rides.find(x=>x.backendRideId===fixture.ride.id);const expected={Accepted:'driver-accepted',DriverArriving:'driver-arriving',Arrived:'arrived',InProgress:'in-progress',Completed:'completed'}[entry.transition];assert.equal(row?.status,expected);entry.officeStatus=row.status;}
    report.requests.push(entry);return {status:r.status,body};
   }finally{controllers.delete(call.id);}
  });
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='https://appassets.androidplatform.net')return route.abort();
   if(process.argv.includes('--real-map')&&['/driver-mobile/maps.js','/driver-mobile/maplibre-gl.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(out,'private','installed-'+path.basename(u.pathname)))});
   if(u.pathname==='/driver-mobile/maps.js')return route.fulfill({contentType:'text/javascript',body:'export async function createJourneyMap(c){c.textContent="خريطة وهمية — QA";return {map:{remove(){},resize(){}},update(){},fit(){}}}'});
   const name=u.pathname.slice(1)||'index.html';
   if(['app.js','app.css','index.html'].includes(name))return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(current?path.join(assets,name):path.join(out,'private','installed-'+name))});
   if(name==='office-logo.webp')return route.fulfill({contentType:'image/webp',body:fs.readFileSync('public/customer-mobile/office-logo.webp')});
   return route.abort();
  });
  await page.goto('https://appassets.androidplatform.net/index.html');
  await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
  await page.evaluate(()=>{
   const channel=new MessageChannel();channel.port1.onmessage=async e=>{const call=JSON.parse(e.data);try{const data=await window.qaNative(call);if(call.type!=='cancel')channel.port1.postMessage(JSON.stringify({id:call.id,data}));}catch(error){channel.port1.postMessage(JSON.stringify({id:call.id,error:error.message}));}};channel.port1.start();
   window.dispatchEvent(new MessageEvent('message',{origin:'',source:null,data:'dispatchpro-connect',ports:[channel.port2]}));
  });
  if(process.argv.includes('--reject')){
   await page.getByRole('button',{name:'رفض',exact:true}).click();
   await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='رفض'),null,{timeout:20000});
   report.rejected=true;console.log(JSON.stringify({rejected:true,errors:report.consoleErrors}));return;
  }
  if(process.argv.includes('--full-cycle')){
   for(const name of ['قبول','في الطريق إلى الزبون','وصلت للزبون'])await page.getByRole('button',{name,exact:true}).click();
  }
  if(process.argv.includes('--start')||process.argv.includes('--full-cycle')){
   await page.getByRole('button',{name:'بدء الرحلة',exact:true}).waitFor({timeout:20000});
   await page.getByRole('button',{name:'بدء الرحلة',exact:true}).click();
  }
  if(process.argv.includes('--expect-boundary')){
   await page.getByRole('heading',{name:'حدث خطأ أثناء تحديث الرحلة'}).waitFor({timeout:10000});
   report.boundaryVisible=true;report.collectionDialogVisible=false;
   await page.screenshot({path:path.join(out,'qa-installed-missing-destination-error.png')});
   if(!process.argv.includes('--office-workaround')){console.log(JSON.stringify({mode:report.mode,boundaryVisible:true,errors:report.consoleErrors,traces:report.traces.slice(-6),mutations:report.requests.filter(r=>r.method==='PUT')}));return;}
   assert.equal(report.requests.filter(r=>r.method==='PUT').length,0);
   const snapshot=await fetch(c.publicOrigin+'/api/v1/reception/snapshot',{headers:{Authorization:'Bearer '+fixture.officeToken}}).then(r=>r.json());
   const detail=await fetch(c.publicOrigin+'/api/v1/rides/'+fixture.ride.id,{headers:{Authorization:'Bearer '+fixture.officeToken}}).then(r=>r.json());
   const row=snapshot.rides.find(r=>r.rideRequestId===detail.ride.rideRequestId);assert.ok(row);
   const r=await fetch(c.publicOrigin+'/api/v1/reception/rides/'+row.id,{method:'PUT',headers:{Authorization:'Bearer '+fixture.officeToken,'Content-Type':'application/json'},body:JSON.stringify({...row,destination:'وجهة وهمية من مكتب QA',dropoff:{name:'وجهة وهمية من مكتب QA',coords:null}})});assert.ok(r.ok);
   const state=await fetch(c.publicOrigin+'/api/v1/driver/rides/'+fixture.ride.id,{headers:{Authorization:'Bearer '+fixture.driverToken}}).then(r=>r.json());assert.equal(state.status,'Arrived');assert.ok(state.destination);
   report.officeWorkaround={destinationSaved:true,stateUnchanged:'Arrived',version:state.version};
   await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).click();
   await page.getByRole('button',{name:'بدء الرحلة',exact:true}).waitFor();
   assert.equal(report.requests.filter(r=>r.method==='PUT').length,0,'Recovery cannot replay start');
   await page.getByRole('button',{name:'بدء الرحلة',exact:true}).click();
  }
  if(process.argv.includes('--supply-destination')){
   await page.getByRole('heading',{name:'حدد الوجهة قبل بدء الرحلة'}).waitFor();
   await page.screenshot({path:path.join(out,'qa-fixed-missing-destination-form.png')});
   assert.equal(report.requests.filter(r=>r.method==='PUT').length,0,'Opening form must not start trip');
   await page.locator('#start-destination').click();
   await page.getByRole('textbox',{name:'اسم أو وصف الموقع'}).fill('وجهة وهمية بعد الإصلاح');
   await page.getByRole('button',{name:'تأكيد الموقع',exact:true}).click();
   await page.getByRole('button',{name:'حفظ الوجهة',exact:true}).click();
   await page.getByRole('heading',{name:'حدد الوجهة قبل بدء الرحلة'}).waitFor({state:'hidden'});
   await page.getByRole('button',{name:'بدء الرحلة',exact:true}).click();
  }
  await page.getByRole('button',{name:'إنهاء الرحلة',exact:true}).waitFor({timeout:20000});
  if(process.argv.includes('--real-map'))await page.evaluate(()=>new Promise(r=>setTimeout(r,1000)));
  await page.getByRole('button',{name:'إنهاء الرحلة',exact:true}).click();
  await page.evaluate(()=>new Promise(r=>setTimeout(r,250)));
  report.boundaryVisible=await page.getByRole('heading',{name:/حدث خطأ أثناء تحديث الرحلة|تعذر عرض واجهة الرحلة/}).count()>0;
  report.collectionDialogVisible=await page.getByRole('button',{name:'تأكيد وإنهاء الرحلة'}).count()>0;
  await page.screenshot({path:path.join(out,current?'qa-current-completion.png':'qa-installed-completion.png')});
  if(finish&&report.collectionDialogVisible){await page.locator('input[type=number]').fill('18');await page.getByRole('button',{name:'تأكيد وإنهاء الرحلة'}).click();await page.waitForFunction(()=>!document.querySelector('[role=dialog]'),null,{timeout:20000});const final=await fetch(c.publicOrigin+'/api/v1/driver/rides/'+fixture.ride.id,{headers:{Authorization:'Bearer '+fixture.driverToken}}).then(r=>r.json());assert.equal(final.status,'Completed');report.completed=true;}
  console.log(JSON.stringify({mode:report.mode,boundaryVisible:report.boundaryVisible,collectionDialogVisible:report.collectionDialogVisible,completed:report.completed,errors:report.consoleErrors,traces:report.traces.slice(-8),mutations:report.requests.filter(r=>r.method==='PUT')}));
 }finally{for(const controller of controllers.values())controller.abort();await browser.close();fs.writeFileSync(path.join(out,current?'ui-current-results.json':'ui-installed-results.json'),JSON.stringify(report,null,2));}
})().catch(e=>{console.error('Installed-bundle QA reproduction:',e.message);process.exitCode=1;});
