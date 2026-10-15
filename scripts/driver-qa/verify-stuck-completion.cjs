const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const fixture=JSON.parse(fs.readFileSync(path.join(out,'private/qa-unpriced-ride.json'),'utf8'));
const {pgEnv,bin}=require('../../artifacts/home-runtime-update-20261010/pg-tools.cjs');
function qaSql(query){const r=spawnSync(path.join(bin,'psql.exe'),['-X','-w','-A','-t','-q','-v','ON_ERROR_STOP=1','-c','BEGIN READ ONLY;'+query+';ROLLBACK;'],{windowsHide:true,encoding:'utf8',env:{...pgEnv,PGDATABASE:c.database,PGUSER:c.role,PGPASSWORD:c.dbPassword}});assert.equal(r.status,0);return r.stdout.trim();}
function countAudit(){return Number(qaSql(`SELECT count(*) FROM "AuditLog" WHERE "EntityId"='${fixture.ride.id}' AND "Action"='ride.status' AND "Detail"='Completed'`));}
async function req(route,token,method='GET',body){const r=await fetch(c.publicOrigin+'/api/v1/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {http:r.status,data:await r.json().catch(()=>null)};}
(async()=>{
 const env=await fetch(c.publicOrigin+'/qa/status').then(r=>r.json());assert.equal(env.environment,'DriverQa');assert.equal(env.database,c.database);assert.equal(env.externalPush,false);assert.equal(env.externalSms,false);
 if(process.argv.includes('--counts-only')){const counts=JSON.parse(qaSql(`SELECT json_build_object('rides',(SELECT count(*) FROM "Ride"),'jobs',(SELECT count(*) FROM "DriverJob"),'calls',(SELECT count(*) FROM "AuditLog" WHERE "Action" LIKE 'ride.call.%'),'realPhones',(SELECT count(*) FROM "Customer" WHERE "Phone" NOT IN ('','QA-PEER')),'promotedJobs',(SELECT count(*) FROM "AuditLog" WHERE "Action"='driver.jobs.promoted')) `));assert.equal(counts.calls,0);assert.equal(counts.realPhones,0);assert.equal(counts.promotedJobs,1);fs.writeFileSync(path.join(out,'final-qa-counts.json'),JSON.stringify(counts,null,2));console.log(JSON.stringify(counts));return;}
 const state=(await req('driver/rides/'+fixture.ride.id,fixture.driverToken)).data;assert.equal(state.status,'Completed');assert.equal(state.finalFare,18);
 const snapshot=(await req('reception/snapshot',fixture.officeToken)).data;
 const detail=(await req('rides/'+fixture.ride.id,fixture.officeToken)).data;
 const row=snapshot.rides.find(r=>r.rideRequestId===detail.ride.rideRequestId);assert.equal(row.status,'completed');assert.equal(row.dispatchStatus,'COMPLETED');assert.equal(row.totalFare,18);
 const driver=(await req('driver/me',fixture.driverToken)).data;assert.equal(driver.status,'Available');
 const before=countAudit();assert.equal(before,1);
 const duplicate=await req('rides/'+state.id+'/status',fixture.driverToken,'PUT',{status:'Completed',version:state.version-1,collectedFare:18});assert.equal(duplicate.http,200);assert.equal(duplicate.data.version,state.version);assert.equal(countAudit(),before);
 const conflict=await req('rides/'+state.id+'/status',fixture.driverToken,'PUT',{status:'Completed',version:state.version-1,collectedFare:19});assert.equal(conflict.http,409);
 const pool=(await req('driver/updates',fixture.driverToken)).data;assert.equal(pool.data.rides.length,0);assert.equal(pool.data.jobs.length,0);
 const report={status:'PASS',qaOnly:true,productionWrites:false,completedStatus:state.status,officeStatus:row.status,officeDispatchStatus:row.dispatchStatus,fare:18,driverStatus:driver.status,duplicateHttp:duplicate.http,duplicateVersionUnchanged:true,completionAuditRows:countAudit(),conflictingDuplicateHttp:conflict.http,activeRides:pool.data.rides.length,queuedJobs:pool.data.jobs.length,externalPush:env.externalPush,externalSms:env.externalSms};
 fs.writeFileSync(path.join(out,'completion-synchronization-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error('Completion verification:',e.message);process.exitCode=1;});
