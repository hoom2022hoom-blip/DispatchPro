// Bounded, read-only QA checks; no driver login or messages/calls/trip mutations.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const report={atUtc:new Date().toISOString(),checks:[],phoneActions:false,productionAccessed:false,driverLoginPerformed:false,newMessagesCallsOrRidesCreated:false};
function check(name,value){assert.ok(value,name);report.checks.push({name,passed:true});}
require('./runtime-preflight.cjs')(c);
assert.equal(c.publicOrigin,'https://localhost:9443');
function request(route,{method='GET',body,token,ca=fs.readFileSync(c.tlsCa),servername='localhost',origin}={}){
 return new Promise((resolve,reject)=>{
  const started=performance.now(),r=https.request(c.publicOrigin+route,{method,ca,servername,timeout:8000,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})}},res=>{
   let data='';res.on('data',b=>data+=b);res.on('end',()=>{let json;try{json=JSON.parse(data);}catch{}resolve({status:res.statusCode,json,ms:Math.round(performance.now()-started)});});
  });r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('QA timeout')));r.end(body?JSON.stringify(body):undefined);
 });
}
function sql(query){
 const r=spawnSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-w','-A','-t','-q','-v','ON_ERROR_STOP=1','-c',`BEGIN READ ONLY; ${query}; COMMIT;`],{encoding:'utf8',windowsHide:true,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:c.database,PGUSER:c.role,PGPASSWORD:c.dbPassword,PGCONNECT_TIMEOUT:'5',PGTZ:'UTC'}});
 assert.equal(r.status,0,'QA read-only SQL failed');return JSON.parse(r.stdout.trim());
}
(async()=>{
 const d=(await request('/qa/status')).json;
 check('Strict TLS, QA environment and existing database',d?.environment==='DriverQa'&&d.database===c.database);
 check('External FCM/SMS disabled and API HTTP egress blocked',!d.externalPush&&!d.externalSms&&d.outboundBlockInstalled);
 check('Operational integration workers absent',!d.hostedWorkers.some(x=>['OfficeCallsWorker','FirebasePushStartup','CustomerPushWorker','DispatchPushWorker'].includes(x)));
 await assert.rejects(request('/qa/status',{ca:null}),e=>['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(e.code));
 check('Untrusted certificate rejected',true);
 await assert.rejects(request('/qa/status',{servername:'wrong-qa-host.invalid'}),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');check('Wrong TLS hostname rejected',true);
 check('Foreign browser origin rejected',(await request('/qa/status',{origin:'https://example.invalid'})).status===403);
 check('Unauthenticated mobile access rejected',(await request('/api/v1/driver/me')).status===401);
 const login=await request('/api/v1/auth/login',{method:'POST',body:{tenant:c.tenant,username:c.officeUser,password:c.officePassword}});
 check('QA office login',login.status===200&&!!login.json.accessToken);const token=login.json.accessToken;
 const proxy=await request('/api/reception/auth/login',{method:'POST',body:{tenant:c.tenant,username:c.officeUser,password:c.officePassword}});
 check('Office proxy bound to same QA tenant',proxy.status===200&&proxy.json.tenant===c.tenant);
 const probe=(await request('/qa/outbound-probe',{token})).json;
 check('External-send probe blocked before any network request',probe?.blocked===true&&probe.networkRequestSent===false);
 for(const route of ['driver/push-device','officecalls/admin/pairings','reception/bridge/calls'])check('External operation blocked: '+route,(await request('/api/v1/'+route,{token,method:'POST',body:{}})).status===403);
 const counts=sql(`SELECT json_build_object('tenants',(SELECT count(*) FROM "Tenant"),'drivers',(SELECT count(*) FROM "Driver"),'customers',(SELECT count(*) FROM "Customer"),'realPhones',(SELECT count(*) FROM "Customer" WHERE "Phone" NOT IN ('','QA-PEER'))+(SELECT count(*) FROM "Driver" WHERE "Phone"<>''),'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'createDatabase',(SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user),'database',current_database())`);
 check('Restricted QA role and only synthetic identities',counts.database===c.database&&counts.tenants===1&&counts.drivers===1&&counts.customers===1&&counts.realPhones===0&&!counts.superuser&&!counts.createDatabase);
 const snapshot=(await request('/api/v1/reception/snapshot',{token})).json;
 check('Office snapshot contains only the fixture driver',snapshot.drivers.length===1&&snapshot.drivers[0].id===c.driverId);
 const times=[];for(let i=0;i<5;i++){const r=await request('/qa/status');assert.equal(r.status,200);times.push(r.ms);}
 report.localHttpsStatusLatencyMs={samples:times,min:Math.min(...times),max:Math.max(...times),mean:Math.round(times.reduce((a,b)=>a+b)/times.length),phoneMeasurement:false};
 report.database=c.database;report.https=c.publicOrigin;report.status='PASS';
})().catch(e=>{report.status='FAIL';report.error=e.message;process.exitCode=1;}).finally(()=>{
 fs.writeFileSync(path.join(out,'local-transport-isolation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
