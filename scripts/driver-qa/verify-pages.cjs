const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const output=process.argv[3]?path.resolve(process.argv[3]):c.out;
(async()=>{
 const {chromium}=await import(pathToFileURL(path.join(c.root,'artifacts/maps-reception-20261006/browser-tools/node_modules/playwright/index.mjs')).href);
 const browser=await chromium.launch({channel:'chrome',headless:true,args:c.tlsPort?require('./local-browser.cjs').args(c):[]});
 const report={https:c.publicOrigin,checks:[],errors:[],blockedMutations:[],externalHosts:[],noLoginOrTransmission:true};
 try{
  for(const viewport of [{width:1280,height:900},{width:393,height:873}]){
   const context=await browser.newContext({viewport,locale:'ar',reducedMotion:'reduce'}),page=await context.newPage();
   page.on('pageerror',e=>report.errors.push(e.message));
   await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==c.publicOrigin){report.externalHosts.push(url.hostname);return route.abort();}
    // The login page probes its HttpOnly session with POST; no credentials are entered.
    if(!['GET','HEAD'].includes(req.method())&&url.pathname!=='/api/reception/auth/session'){report.blockedMutations.push({path:url.pathname,method:req.method()});return route.abort();}
    return route.continue();
   });
   await page.goto(c.publicOrigin+'/qa/station',{waitUntil:'networkidle'});
   await page.getByRole('heading',{name:'محطة اختبار DispatchPro QA'}).waitFor();
   assert.equal(await page.locator('input[type=password]').count(),1);
   assert.equal(await page.locator('button').count(),1,'Unauthenticated station cannot create trips or transmit');
   assert.equal(await page.locator('main').evaluate(e=>getComputedStyle(e).direction),'rtl');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Station fits viewport');
   await page.screenshot({path:path.join(output,`station-${viewport.width}.png`),fullPage:true});
   report.checks.push({page:'station',viewport,rtl:true,unauthenticated:true});
   await page.goto(c.publicOrigin+'/office',{waitUntil:'domcontentloaded'});
   await page.locator('input[type=password]').first().waitFor();
   await page.getByText('QA — بيئة اختبار معزولة — لا بيانات تشغيل',{exact:false}).waitFor();
   assert.equal(await page.locator('input[type=password]').count(),1);
   await page.screenshot({path:path.join(output,`office-login-${viewport.width}.png`),fullPage:true});
   report.checks.push({page:'office-login',viewport,qaBanner:true});
   await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedMutations,[]);
  report.status='PASS';console.log(JSON.stringify({status:report.status,checks:report.checks.length,noLoginOrTransmission:true}));
 }catch(e){report.status='FAIL';report.error=e.message;throw e;}
 finally{fs.writeFileSync(path.join(output,'pages-results.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error('QA pages failed:',e.message);process.exitCode=1;});
