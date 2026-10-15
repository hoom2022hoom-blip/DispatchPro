// Supplemental coverage plus the explicitly requested short API journey.
// No login as the phone driver, live QA orders, calls, audio or APK builds.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
require('./runtime-preflight.cjs')(c);
const {pgEnv}=require('../../artifacts/home-runtime-update-20261010/pg-tools.cjs');
assert.ok(['127.0.0.1','localhost','::1'].includes(pgEnv.PGHOST));
const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
const admin=`Host=${quote(pgEnv.PGHOST)};Port=${quote(pgEnv.PGPORT)};Database=postgres;Username=${quote(pgEnv.PGUSER)};Password=${quote(pgEnv.PGPASSWORD)}`;
const files=['tests/comprehensive-voice.test.mjs','tests/final-master-gps.test.mjs','tests/mobile-journey-map.test.mjs','tests/unified-location-picker.test.mjs'];
const report={startedAtUtc:new Date().toISOString(),priorSuccessfulSuitesReused:true,nodeFiles:files,phoneActions:false,newLiveQaMessagesCallsOrRides:false,productionDatabaseOpened:false,stages:[]};
const stages=[{name:'supplemental-web',program:process.execPath,args:['--experimental-strip-types','--test','--test-concurrency=2',...files]},
 {name:'disposable-journey',program:'dotnet',args:['test','backend/DispatchPro.Tests/DispatchPro.Tests.csproj','--no-build','--artifacts-path',path.join(out,'dotnet'),'--filter','FullyQualifiedName=DispatchPro.Tests.DriverFreshRideCaptureTests.FreshDriverAndFreshRideExportActualResponsesThroughEveryTransition','--logger','trx;LogFileName=qa7-short-journey.trx','--results-directory',out],env:{TAXI_TEST_POSTGRES:admin,CustomerPush__Enabled:'false',CustomerPush__ProjectId:'',CustomerSms__Provider:'QA_DISABLED',DISPATCHPRO_KEEP_TEST_DATABASES:'false',DRIVER_CAPTURE_PATH:path.join(out,'private/qa7-disposable-journey.json'),DRIVER_CAPTURE_CUSTOMER_APP:'false',DRIVER_CAPTURE_FARE_MODE:'OFFICE_MANUAL'}}];
function run(s){return new Promise(resolve=>{const started=Date.now(),log=fs.openSync(path.join(out,'private',s.name+'.log'),'w');const child=spawn(s.program,s.args,{cwd:c.root,windowsHide:true,env:{...process.env,...s.env},stdio:['ignore',log,log]});child.on('error',()=>{});child.on('close',code=>{fs.closeSync(log);resolve({name:s.name,exitCode:code??-1,ms:Date.now()-started});});});}
(async()=>{
 for(const stage of stages){const result=await run(stage);report.stages.push(result);console.log(JSON.stringify(result));}
 report.finishedAtUtc=new Date().toISOString();report.status=report.stages.every(s=>s.exitCode===0)?'PASS':'FAIL';
 fs.writeFileSync(path.join(out,'qa7-remaining-batch.json'),JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;
})();
