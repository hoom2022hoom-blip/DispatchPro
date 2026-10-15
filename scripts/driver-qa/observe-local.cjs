// Observe QA office/GPS only; no driver login, signaling or transmissions.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const configPath=process.argv[2],c=JSON.parse(fs.readFileSync(configPath,'utf8')),out=path.resolve(process.argv[3]);
require('./runtime-preflight.cjs')(c);assert.equal(c.publicOrigin,'https://localhost:9443');
const req=(route,token,body)=>new Promise((resolve,reject)=>{const r=https.request(c.publicOrigin+route,{ca:fs.readFileSync(c.tlsCa),timeout:8000,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(text));}catch(e){reject(e);}});});r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('QA timeout')));r.end(body?JSON.stringify(body):undefined);});
(async()=>{
 const safety=await req('/qa/status');assert.equal(safety.database,c.database);assert.equal(safety.environment,'DriverQa');assert.equal(safety.externalPush,false);assert.equal(safety.externalSms,false);assert.equal(safety.outboundBlockInstalled,true);
 const login=await req('/api/v1/auth/login',null,{tenant:c.tenant,username:c.officeUser,password:c.officePassword});const token=login.accessToken;
 const [snapshot,drivers,jobs]=await Promise.all([req('/api/v1/reception/snapshot',token),req('/api/v1/drivers',token),req('/api/v1/reception/jobs',token)]);
 assert.equal(drivers.length,1);assert.equal(drivers[0].id,c.driverId);assert.equal(snapshot.drivers.length,1);
 assert.match(c.driverId,/^[a-f0-9-]{36}$/i);
 const query=`BEGIN READ ONLY; SELECT json_build_object('storedRows',count(*),'lastUpdateAt',max("UpdatedAt"),'ageSeconds',extract(epoch from (now()-max("UpdatedAt"))),'accuracyMeters',max("Accuracy")) FROM "DriverLocation" WHERE "DriverId"='${c.driverId}'; COMMIT;`;
 const sql=spawnSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',windowsHide:true,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:c.database,PGUSER:c.role,PGPASSWORD:c.dbPassword,PGCONNECT_TIMEOUT:'5',PGTZ:'UTC'}});assert.equal(sql.status,0,'QA-only GPS observation failed');
 const gps=JSON.parse(sql.stdout.trim());
 const report={atUtc:new Date().toISOString(),status:'PASS',database:c.database,httpsCertificateVerified:true,externalPush:false,externalSms:false,outboundBlockInstalled:true,qaDriverStatus:drivers[0].status,queuedJobs:jobs.length,activeQaRides:snapshot.rides.filter(r=>['assigned','driver-accepted','driver-arriving','arrived','in-progress'].includes(r.status)).length,gpsObservation:gps,coordinatesDisclosed:false,movingGpsTested:false,driverLoginPerformedByTools:false,newMessagesCallsRides:false,productionAccessed:false};
 fs.writeFileSync(path.join(out,'qa7-local-observation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error('QA observation failed: '+e.message);process.exitCode=1;});
