// Restart only the already-validated QA API, using its existing DLL/config.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const configPath=path.resolve(process.argv[2]),c=JSON.parse(fs.readFileSync(configPath,'utf8')),out=path.resolve(process.argv[3]);
require('./runtime-preflight.cjs')(c);assert.equal(c.publicOrigin,'https://localhost:9443');
function status(){return new Promise((resolve,reject)=>{const r=https.get(c.publicOrigin+'/qa/status',{ca:fs.readFileSync(c.tlsCa),timeout:2000},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(raw)});}catch(e){reject(e);}});});r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('QA timeout')));});}
(async()=>{
 const before=await status();assert.equal(before.status,200);assert.equal(before.data.environment,'DriverQa');assert.equal(before.data.database,c.database);
 const log=fs.openSync(path.join(out,'private/local-recovery.log'),'w');
 const child=spawn(process.execPath,[path.join(__dirname,'restart-api.cjs'),configPath,c.apiDll],{cwd:c.root,windowsHide:true,stdio:['ignore',log,log]});
 const exit=new Promise(resolve=>child.once('close',code=>{fs.closeSync(log);resolve(code);}));
 const codes=[];let gatewayDowntimeObserved=false;
 // Bounded sampling, no driver login or API mutation beyond process restart.
 for(let i=0;i<12;i++){
  const sample=await status();codes.push(sample.status);
  if(sample.status===503){assert.equal(sample.data.code,'QA_UPSTREAM_UNAVAILABLE');gatewayDowntimeObserved=true;}
  await new Promise(r=>setTimeout(r,200));
 }
 assert.equal(await exit,0,'Read the private QA restart log');
 const after=await status();assert.equal(after.status,200);assert.equal(after.data.database,c.database);assert.equal(after.data.outboundBlockInstalled,true);
 const report={status:'PASS',atUtc:new Date().toISOString(),restarted:'QA API only; same DLL/database/credentials',httpSamples:codes,gatewayDowntimeObserved,apiRecovered:true,phoneRecoveryVerified:false,productionRestarted:false,newMessagesCallsOrRidesCreated:false};
 fs.writeFileSync(path.join(out,'local-recovery-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error('QA recovery check failed: '+e.message);process.exitCode=1;});
