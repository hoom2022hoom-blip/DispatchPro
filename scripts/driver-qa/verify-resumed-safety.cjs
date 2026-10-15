// Recheck changed QA runtime only; reuse prior database privilege evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const c=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
(async()=>{
 const checks=[];function check(name,ok){assert.ok(ok,name);checks.push({name,passed:true});}
 const s=await fetch(c.publicOrigin+'/qa/status').then(r=>r.json());check('HTTPS binds to the existing isolated database',s.environment==='DriverQa'&&s.database===c.database);
 check('External transport and workers remain isolated',s.outboundBlockInstalled&&!s.externalPush&&!s.externalSms&&!s.hostedWorkers.some(x=>/OfficeCalls|FirebasePush|CustomerPush|DispatchPush/.test(x)));
 const fixture=JSON.parse(fs.readFileSync(path.join(out,'private/qa-unpriced-ride.json')));const office=fixture.officeToken;
 async function req(route,body,token=office){return fetch(c.publicOrigin+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});}
 const probe=await (await req('/qa/outbound-probe')).json();check('Outbound rejected before network transmission',probe.blocked&&probe.networkRequestSent===false);
 for(const route of ['driver/push-device','officecalls/admin/pairings','reception/bridge/calls'])check('External route blocked: '+route,(await req('/api/v1/'+route,{})).status===403);
 check('Non-QA contact rejected',(await req('/api/v1/customers',{fullName:'QA ONLY',phone:'NOT_A_QA_CONTACT'})).status===403);
 const payload=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const raw=payload({alg:'HS256',typ:'JWT'})+'.'+payload({iss:'DispatchPro',aud:'DispatchPro',sub:crypto.randomUUID(),tenant:crypto.randomUUID(),exp:Math.floor(Date.now()/1000)+60});const foreign=raw+'.'+crypto.createHmac('sha256',c.signingKey).update(raw).digest('base64url');check('Foreign tenant rejected',(await req('/api/v1/driver/me',null,foreign)).status===403);
 const proxy=await req('/api/reception/reception/snapshot'),proxied=await proxy.json();check('Office HTTPS proxy uses QA tenant',proxy.ok&&proxied.drivers.length===1&&proxied.drivers[0].id===c.driverId);
 const rows=await (await req('/api/v1/reception/snapshot')).json();check('Only QA driver and synthetic contact fields',rows.drivers.length===1&&rows.drivers[0].id===c.driverId&&rows.rides.every(r=>!r.passengerPhone||r.passengerPhone==='QA-PEER'));
 const state=await (await req('/api/v1/driver/updates',null,fixture.driverToken)).json();check('QA driver available; no active journeys or queued jobs',state.data.driver.id===c.driverId&&state.data.driver.status==='Available'&&state.data.rides.length===0&&state.data.jobs.length===0);
 const report={status:'PASS',at:new Date().toISOString(),checks,productionWrites:false,realContactsUsed:false,https:c.publicOrigin,database:c.database};fs.writeFileSync(path.join(out,'resumed-safety-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'PASS',checks:checks.length,externalPush:false,externalSms:false}));
})().catch(e=>{console.error('Safety check failed:',e.message);process.exitCode=1;});
