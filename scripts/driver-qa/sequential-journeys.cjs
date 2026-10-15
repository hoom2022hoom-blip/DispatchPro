// Real HTTPS QA + actual bundled Android UI in headless Chrome; not a phone test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const c=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
const report={physicalDevice:false,qaOnly:true,productionWrites:false,results:[]};
(async()=>{
 assert.match(c.database,/^dispatchpro_driverqa_20261012_[a-f0-9]{8}$/);
 const safety=await fetch(c.publicOrigin+'/qa/status').then(r=>r.json());assert.equal(safety.environment,'DriverQa');assert.equal(safety.database,c.database);assert.equal(safety.externalSms,false);assert.equal(safety.externalPush,false);assert.equal(safety.outboundBlockInstalled,true);
 async function req(p,t,method='GET',body){const r=await fetch(c.publicOrigin+'/api/v1/'+p,{method,headers:{Authorization:t?'Bearer '+t:'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const raw=await r.text();assert.ok(r.ok,`${p}: HTTP ${r.status}`);return raw?JSON.parse(raw):null;}
 const office=(await req('auth/login',null,'POST',{tenant:c.tenant,username:c.officeUser,password:c.officePassword})).accessToken;
 const driver=(await req('auth/driver-login',null,'POST',{tenant:c.tenant,username:c.driverUser,password:c.driverPassword,deviceId:'qa-sequential-ui'})).accessToken;
 assert.equal((await req('reception/jobs',office)).length,0,'Do not modify an existing QA queue');
 const active=(await req('driver/updates',driver)).data.rides;
 const resume=process.argv.includes('--resume-first-offer');assert.equal(active.length,resume?1:0,'Do not modify an existing active QA journey');
 if(resume){const d=(await req('rides/'+active[0].id,office));assert.equal(d.ride.status,'Assigned');assert.equal(d.request.customerId,c.customerId);assert.equal(d.request.pickup,'انطلاق وهمي — QA');assert.equal(d.request.destination,'وجهة وهمية — QA');assert.equal(d.request.source,'MANUAL');}
 let start=0;
 if(process.argv.includes('--resume-after-rejection')){
  const saved=JSON.parse(fs.readFileSync(path.join(out,'sequential-journeys-results.json')));assert.equal(saved.results.length,6);assert.ok(saved.results.every(r=>r.result==='Completed'));report.results=saved.results;
  const f=JSON.parse(fs.readFileSync(path.join(out,'private/qa-unpriced-ride.json'))),d=await req('rides/'+f.ride.id,office);assert.equal(d.ride.status,'Rejected');assert.equal(d.request.source,'LANDLINE');assert.equal(d.request.destination,'وجهة وهمية — QA');
  const row=(await req('reception/snapshot',office)).rides.find(r=>r.backendRideId===f.ride.id);assert.equal(row.status,'waiting');assert.equal(row.dispatchStatus,'REJECTED');assert.ok(!row.driverId);
  const ui=JSON.parse(fs.readFileSync(path.join(out,'ui-current-results.json')));assert.equal(ui.rejected,true);assert.equal(ui.consoleErrors.length,0);
  const state=(await req('driver/updates',driver)).data;assert.equal(state.driver.status,'Available');assert.equal(state.rides.length,0);assert.equal(state.jobs.length,0);
  report.results.push({case:7,rideId:f.ride.id,route:'reception',source:'LANDLINE_ICALL',hasDestination:true,result:'Rejected',officeStatus:'waiting',officeDispatchStatus:'REJECTED',driverStatus:'Available',destinationPreserved:true,activeRides:0,queuedJobs:0,transitions:[]});fs.copyFileSync(path.join(out,'ui-current-results.json'),path.join(out,'case-7-ui.json'));start=7;
 }
 for(let n=start;n<8;n++){
  const destination=n%2?'':'وجهة وهمية — QA',reject=n>=6,route=n<2?'ride-requests':'reception',source=n<4?'MANUAL':'LANDLINE_ICALL';
  let ride;
  if(resume&&n===0)ride=active[0];
  else if(route==='ride-requests')ride=await req(route,office,'POST',{customerId:c.customerId,pickup:'انطلاق وهمي — QA',destination,source});
  else{const id='qa-sequence-'+crypto.randomUUID();const row=await req('reception/rides/'+id,office,'PUT',{id,source,status:'pending',passengerName:'زبون وهمي QA',passengerPhone:'',pickup:{name:'انطلاق وهمي — QA'},dropoff:destination?{name:destination}:null,totalFare:null});assert.ok(row.backendRideId);ride=(await req('rides/'+row.backendRideId,office)).ride;}
  // Use the ordinary office send-to-driver action (not database assignment).
  if(!(resume&&n===0))await req('reception/jobs',office,'POST',{type:'send',rideId:ride.id,driverId:c.driverId,version:ride.version,shareCustomerPhone:false});
  const offered=await req('driver/rides/'+ride.id,driver);assert.equal(offered.status,'Assigned');assert.equal(offered.destination,destination);assert.equal(offered.fullName,undefined);assert.equal(offered.phone,undefined);
  fs.writeFileSync(path.join(out,'private/qa-unpriced-ride.json'),JSON.stringify({ride:offered,driverToken:driver,officeToken:office,origin:c.publicOrigin}));
  const args=['scripts/driver-qa/reproduce-installed-ui.cjs',process.argv[2],out,'--current','--assets='+path.join(out,'qa-assets'),...(reject?['--reject']:['--full-cycle','--finish'])];
  const run=spawnSync(process.execPath,args,{windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:1024*1024});fs.writeFileSync(path.join(out,`case-${n+1}.log`),(run.stdout||'')+(run.stderr||''));assert.equal(run.status,0,`UI case ${n+1} failed; see its log`);
  const ui=JSON.parse(fs.readFileSync(path.join(out,'ui-current-results.json')));assert.equal(ui.consoleErrors.length,0);assert.ok(!ui.boundaryVisible);assert.ok(!ui.traces.some(t=>t.event==='render-failed'));
  const detail=await req('rides/'+ride.id,office);assert.equal(detail.ride.status,reject?'Rejected':'Completed');assert.equal(detail.request.destination,destination);if(!destination){assert.equal(detail.request.destinationLatitude,null);assert.equal(detail.request.destinationLongitude,null);}
  const snapshot=await req('reception/snapshot',office),row=snapshot.rides.find(r=>r.backendRideId===ride.id);assert.ok(row);assert.equal(row.status,reject?'waiting':'completed');assert.equal(row.dispatchStatus,reject?'REJECTED':'COMPLETED');
  const state=await req('driver/updates',driver);assert.equal(state.data.driver.status,'Available');assert.equal(state.data.rides.length,0);assert.equal(state.data.jobs.length,0);
  if(!reject){assert.equal(detail.ride.finalFare,18);assert.deepEqual(ui.requests.filter(r=>r.transition).map(r=>r.transition),['Accepted','DriverArriving','Arrived','InProgress','Completed']);const duplicate=await req('rides/'+ride.id+'/status',driver,'PUT',{status:'Completed',version:detail.ride.version-1,collectedFare:18});assert.equal(duplicate.version,detail.ride.version);}
  fs.copyFileSync(path.join(out,'ui-current-results.json'),path.join(out,`case-${n+1}-ui.json`));
  report.results.push({case:n+1,rideId:ride.id,route,source,hasDestination:!!destination,result:detail.ride.status,officeStatus:row.status,driverStatus:'Available',destinationPreserved:true,activeRides:0,queuedJobs:0,transitions:ui.requests.filter(r=>r.transition).map(r=>({status:r.transition,http:r.http,office:r.officeStatus}))});
  console.log(`QA case ${n+1}/8: ${detail.ride.status}, destination=${!!destination}, driver=Available`);
 }
 report.status='PASS';report.completed=6;report.rejected=2;report.withDestination=4;report.withoutDestination=4;
 fs.writeFileSync(path.join(out,'sequential-journeys-results.json'),JSON.stringify(report,null,2));
})().catch(e=>{report.status='FAIL';report.error=e.message;fs.writeFileSync(path.join(out,'sequential-journeys-results.json'),JSON.stringify(report,null,2));console.error(e.message);process.exitCode=1;});
