const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=path.resolve(process.argv[3]);
const report={at:new Date().toISOString(),qaOnly:true,steps:[],productionWrites:false};
async function request(route,token,method='GET',body){
 const r=await fetch(c.publicOrigin+'/api/v1/'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const raw=await r.text(),data=raw?JSON.parse(raw):null;return {status:r.status,data};
}
function ok(result){assert.ok(result.status>=200&&result.status<300,'QA HTTP '+result.status);return result.data;}
function record(name,result){report.steps.push({name,http:result.status,status:result.data?.status,code:result.data?.code});}
(async()=>{
 const env=await fetch(c.publicOrigin+'/qa/status').then(r=>r.json());assert.equal(env.environment,'DriverQa');assert.equal(env.database,c.database);assert.equal(env.externalPush,false);assert.equal(env.externalSms,false);assert.equal(env.outboundBlockInstalled,true);
 const office=ok(await request('auth/login',null,'POST',{tenant:c.tenant,username:c.officeUser,password:c.officePassword})).accessToken;
 const driver=ok(await request('auth/driver-login',null,'POST',{tenant:c.tenant,username:c.driverUser,password:c.driverPassword,deviceId:'qa-stuck-trip-reproduction'})).accessToken;
 const before=ok(await request('reception/snapshot',office));assert.ok(before.rides.every(r=>['completed','cancelled'].includes(r.status)),'Do not overwrite an existing active QA journey');
 let ride=ok(await request('ride-requests',office,'POST',{customerId:c.customerId,pickup:'نقطة اختبار وهمية',destination:'وجهة اختبار وهمية',source:'MANUAL',notes:'QA diagnosis only: no fare, no real customer'}));
 report.qaRideId=ride.id;report.qaRequestId=ride.rideRequestId;
 ride=ok(await request('rides/'+ride.id+'/assignment',office,'PUT',{driverId:c.driverId,version:ride.version}));
 for(const status of ['Accepted','DriverArriving','Arrived']){const result=await request('rides/'+ride.id+'/status',driver,'PUT',{status,version:ride.version});record(status,result);ride=ok(result);}
 if(process.argv.includes('--arrived')){
  for(let i=0;i<3;i++){
   const queued=ok(await request('ride-requests',office,'POST',{customerId:c.customerId,pickup:'انطلاق وهمي '+(i+1),destination:'وجهة وهمية '+(i+1),source:'MANUAL'}));
   ok(await request('reception/jobs',office,'POST',{type:'add',rideId:queued.id,version:queued.version,driverId:c.driverId,shareCustomerPhone:false}));
  }
  const state=ok(await request('driver/rides/'+ride.id,driver));
  const snapshot=ok(await request('driver/updates',driver));assert.equal(snapshot.data.jobs.length,3);
  fs.writeFileSync(path.join(out,'private/qa-unpriced-ride.json'),JSON.stringify({ride:state,driverToken:driver,officeToken:office,origin:c.publicOrigin},null,2));
  report.status='ARRIVED_WITH_THREE_SYNTHETIC_JOBS';report.queued=3;fs.writeFileSync(path.join(out,'qa-start-reproduction.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
 }
 let result=await request('rides/'+ride.id+'/status',driver,'PUT',{status:'Completed',version:ride.version});record('Invalid Arrived to Completed',result);assert.equal(result.status,409);
 result=await request('rides/'+ride.id+'/status',driver,'PUT',{status:'InProgress',version:ride.version});record('Start unpriced office journey',result);ride=ok(result);assert.equal(ride.status,'InProgress');
 const state=ok(await request('driver/rides/'+ride.id,driver));assert.equal(state.finalFare,null);
 report.unpricedInProgress=state;
 fs.writeFileSync(path.join(out,'private/qa-unpriced-ride.json'),JSON.stringify({ride:state,driverToken:driver,officeToken:office,origin:c.publicOrigin},null,2));
 result=await request('rides/'+ride.id+'/status',driver,'PUT',{status:'Completed',version:ride.version});record('Completion without fare',result);assert.equal(result.status,409);assert.equal(result.data.code,'FINAL_FARE_REQUIRED');
 const unchanged=ok(await request('driver/rides/'+ride.id,driver));assert.equal(unchanged.status,'InProgress');assert.equal(unchanged.version,ride.version);
 // Leave only this synthetic ride active for the actual installed-bundle UI reproduction.
 report.status='REPRODUCED_VALIDATION';report.unpricedInProgress={id:state.id,status:state.status,version:state.version,finalFare:state.finalFare,fareMode:state.fareMode};
 fs.writeFileSync(path.join(out,'qa-reproduction.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{report.status='FAIL';report.error=e.message;fs.writeFileSync(path.join(out,'qa-reproduction.json'),JSON.stringify(report,null,2));console.error('QA reproduction:',e.message);process.exitCode=1;});
