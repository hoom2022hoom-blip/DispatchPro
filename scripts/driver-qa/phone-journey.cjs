// Create/observe synthetic office orders. NEVER logs in as the phone driver,
// changes a ride status, or reads/writes production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const configPath=process.argv[2],out=path.resolve(process.argv[3]),c=JSON.parse(fs.readFileSync(configPath));
const fixturePath=path.join(out,'private/phone-journey.private.json');
(async()=>{
 assert.match(c.database,/^dispatchpro_driverqa_20261012_[a-f0-9]{8}$/);assert.equal(c.tenant,'driver-qa');assert.equal(new URL(c.publicOrigin).protocol,'https:');
 const s=await fetch(c.publicOrigin+'/qa/status',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());assert.equal(s.environment,'DriverQa');assert.equal(s.database,c.database);assert.equal(s.externalPush,false);assert.equal(s.externalSms,false);assert.equal(s.outboundBlockInstalled,true);
 async function req(p,t,method='GET',body){const r=await fetch(c.publicOrigin+'/api/v1/'+p,{method,headers:{Authorization:t?'Bearer '+t:'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const raw=await r.text();assert.ok(r.ok,`${method} ${p}: HTTP ${r.status}`);return raw?JSON.parse(raw):null;}
 let f=fs.existsSync(fixturePath)?JSON.parse(fs.readFileSync(fixturePath)):null;
 let office=f?.officeToken;
 if(!office||(await fetch(c.publicOrigin+'/api/v1/me',{headers:{Authorization:'Bearer '+office}})).status!==200)office=(await req('auth/login',null,'POST',{tenant:c.tenant,username:c.officeUser,password:c.officePassword})).accessToken;
 const create=process.argv.includes('--create');
 if(create){
  const number=Number(process.argv.find(a=>a.startsWith('--case='))?.slice(7)||1);assert.ok(Number.isInteger(number)&&number>=1&&number<=5);
  const snapshot=await req('reception/snapshot',office);assert.equal(snapshot.drivers.length,1);assert.equal(snapshot.drivers[0].id,c.driverId);
  const driver=(await req('drivers',office)).find(d=>d.id===c.driverId);assert.equal(driver.status,'Available','QA driver must be available');
  assert.equal((await req('reception/jobs',office)).length,0,'Do not overwrite a waiting queue');
  assert.ok(!(await req('rides',office)).some(r=>r.driverId===c.driverId&&['Assigned','Accepted','DriverArriving','Arrived','InProgress'].includes(r.status)),'Do not overwrite an active QA ride');
  if(f?.rideId){const previous=await req('rides/'+f.rideId,office);assert.ok(['Completed','Rejected','Cancelled'].includes(previous.ride.status),'Finish the previous phone fixture first');}
  const destination=number===2?'':'وجهة اختبار الهاتف — QA',fare=number===2?null:25;
  f={case:number,officeToken:office,origin:c.publicOrigin,createdAt:new Date().toISOString(),stage:'CREATING',destination,fare};fs.writeFileSync(fixturePath,JSON.stringify(f,null,2));
  const created=await req('ride-requests',office,'POST',{customerId:c.customerId,source:'MANUAL',destination,location:{addressText:'انطلاق اختبار الهاتف — QA',latitude:32.2211,longitude:35.2544,locationSource:'MAP_PIN'},notes:'QA PHONE ONLY — synthetic journey '+number});
  f.rideId=created.id;f.requestId=created.rideRequestId;f.stage='CREATED';fs.writeFileSync(fixturePath,JSON.stringify(f,null,2));
  if(destination||fare!==null){const row=(await req('reception/snapshot',office)).rides.find(r=>r.rideRequestId===f.requestId);assert.ok(row);await req('reception/rides/'+row.id,office,'PUT',{...row,totalFare:fare,dropoff:destination?{name:destination,coords:{x:32.225,y:35.261}}:null});}
  const fresh=(await req('rides/'+f.rideId,office)).ride;
  // Ordinary office send action, pinned to the sole QA driver, not AUTO_NEAREST.
  await req('reception/jobs',office,'POST',{type:'send',rideId:f.rideId,driverId:c.driverId,version:fresh.version,shareCustomerPhone:false});f.stage='SENT';
 }
 assert.ok(f?.rideId,'No phone fixture has been created');f.officeToken=office;fs.writeFileSync(fixturePath,JSON.stringify(f,null,2));
 const detail=await req('rides/'+f.rideId,office),snapshot=await req('reception/snapshot',office),row=snapshot.rides.find(r=>r.backendRideId===f.rideId),driver=(await req('drivers',office)).find(d=>d.id===c.driverId);
 assert.ok(row);assert.equal(detail.request.customerId,c.customerId);assert.equal(detail.request.destination,f.destination);assert.equal(detail.request.source,'MANUAL');
 const report={at:new Date().toISOString(),case:f.case,physicalDeviceJourney:true,qaOnly:true,productionWrites:false,driverLoginPerformedByTool:false,rideStatus:detail.ride.status,version:detail.ride.version,officeStatus:row.status,officeDispatchStatus:row.dispatchStatus,driverStatus:driver.status,destinationSpecified:!!detail.request.destination,destinationPreserved:true,fare:detail.ride.finalFare,queuedJobs:(await req('reception/jobs',office)).length};
 fs.appendFileSync(path.join(out,'phone-journey-observations.jsonl'),JSON.stringify(report)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error('QA phone journey:',e.message,'— no automatic retry or status mutation');process.exitCode=1;});
