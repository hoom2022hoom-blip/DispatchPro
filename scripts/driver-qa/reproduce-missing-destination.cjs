const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
(async()=>{
 const env=await fetch(c.publicOrigin+'/qa/status').then(r=>r.json());assert.equal(env.environment,'DriverQa');assert.equal(env.database,c.database);
 async function req(p,t,method='GET',body){const r=await fetch(c.publicOrigin+'/api/v1/'+p,{method,headers:{Authorization:t?'Bearer '+t:'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const raw=await r.text();assert.ok(r.ok,'QA '+p+' HTTP '+r.status);return raw?JSON.parse(raw):null;}
 const office=(await req('auth/login',null,'POST',{tenant:c.tenant,username:c.officeUser,password:c.officePassword})).accessToken;
 const driver=(await req('auth/driver-login',null,'POST',{tenant:c.tenant,username:c.driverUser,password:c.driverPassword,deviceId:'qa-missing-destination'})).accessToken;
 // Cancel only synthetic cases created by these tests, through normal QA endpoints.
 let removed=0;
 while(true){const jobs=await req('reception/jobs',office);if(!jobs.length)break;assert.ok(removed<10);const j=jobs[0];assert.equal(j.driverId,c.driverId);await req('reception/jobs',office,'POST',{type:'remove',rideId:j.rideId,version:j.version});removed++;}
 for(const r of await req('rides',office)){if(['Completed','Cancelled'].includes(r.status))continue;await req('rides/'+r.id+'/status',office,'PUT',{status:'Cancelled',version:r.version});}
 let ride=await req('ride-requests',office,'POST',{customerId:c.customerId,pickup:'انطلاق وهمي — طلب قديم بلا وجهة',destination:'وجهة مؤقتة لاختبار طلب قديم',source:'MANUAL',notes:'QA ONLY missing destination reproduction'});
 ride=await req('rides/'+ride.id+'/assignment',office,'PUT',{driverId:c.driverId,version:ride.version});
 for(const status of ['Accepted','DriverArriving','Arrived'])ride=await req('rides/'+ride.id+'/status',driver,'PUT',{status,version:ride.version});
 const row=(await req('reception/snapshot',office)).rides.find(r=>r.rideRequestId===ride.rideRequestId);assert.ok(row);
 await req('reception/rides/'+row.id,office,'PUT',{...row,source:'LANDLINE_ICALL',destination:'',dropoff:{name:'',coords:null}});
 const state=await req('driver/rides/'+ride.id,driver);assert.equal(state.status,'Arrived');assert.equal(state.destination,'');assert.ok(['LANDLINE','MANUAL'].includes(state.source));
 fs.writeFileSync(path.join(out,'private/qa-unpriced-ride.json'),JSON.stringify({ride:state,driverToken:driver,officeToken:office,origin:c.publicOrigin},null,2));
 const report={qaOnly:true,productionWrites:false,fixture:{id:state.id,status:state.status,version:state.version,source:state.source,destination:state.destination,finalFare:state.finalFare},removedSyntheticJobs:removed};fs.writeFileSync(path.join(out,'missing-destination-fixture.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
