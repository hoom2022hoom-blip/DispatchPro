// Live local acceptance using only the existing, explicitly labelled test accounts.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});
const load=name=>JSON.parse(fs.readFileSync('.dispatchpro-local/'+name,'utf8'));
const driver=load('driver-field-account.json'),customer=load('customer-mvp-test-account.json'),office=load('office-test-account.json');
assert.equal(driver.tenant,'office-test-ba6da3f686');assert.equal(customer.tenant,driver.tenant);assert.equal(office.tenant,driver.tenant);
assert.match(driver.driverId,/^[a-f0-9-]{36}$/);
const parts=Object.fromEntries(process.env.ConnectionStrings__Taxi.split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).toLowerCase(),x.slice(i+1)];}));
const env={...process.env,PGHOST:parts.host,PGPORT:parts.port,PGUSER:parts.username,PGPASSWORD:parts.password,PGDATABASE:parts.database};
function sql(query){const r=spawnSync('.tools/pgsql/bin/psql.exe',['-X','-v','ON_ERROR_STOP=1','-Atc',query],{env,encoding:'utf8',windowsHide:true});if(r.error||r.status!==0)throw Error('Local test database verification failed: '+(r.error?.code||r.stderr));return r.stdout.trim();}
const tenant=sql(`SELECT "TenantId" FROM "Driver" WHERE "Id"='${driver.driverId}'`);assert.match(tenant,/^[a-f0-9-]{36}$/);
assert.equal(sql(`SELECT "Slug" FROM "Tenant" WHERE "Id"='${tenant}'`),driver.tenant);
assert.equal(sql(`SELECT COUNT(*) FROM "Ride" WHERE "TenantId"='${tenant}' AND "DispatchMode"!='MANUAL' AND "Status" IN (0,1)`),'0','Do not interfere with other automatic requests');
assert.equal(sql(`SELECT COUNT(*) FROM "Driver" d JOIN "DriverLocation" l ON l."DriverId"=d."Id" WHERE d."TenantId"='${tenant}' AND d."Id"!='${driver.driverId}' AND d."Active" AND d."Status"=1 AND l."UpdatedAt">now()-interval '10 minutes'`),'0','Do not offer a test request to another driver');
const where=`"DriverId"='${driver.driverId}' AND "TenantId"='${tenant}'`;
const saved=sql(`SELECT json_build_object('latitude',ST_Y("Position"::geometry),'longitude',ST_X("Position"::geometry),'accuracy',"Accuracy",'updatedAt',"UpdatedAt") FROM "DriverLocation" WHERE ${where}`);
const base='http://127.0.0.1:9005';
async function call(path,token,method='GET',body,headers={}){
 const r=await fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
 const text=await r.text();assert.ok(r.ok,path+' '+r.status+' '+text.slice(0,180));return {data:JSON.parse(text),etag:r.headers.get('etag')};
}
const api=async(...args)=>(await call(...args)).data;
const dt=(await api('/api/reception/auth/login',null,'POST',driver)).accessToken;
const ct=(await api('/api/customer/login',null,'POST',{tenant:customer.tenant,username:'customer-'+customer.accountId.replaceAll('-',''),password:customer.deviceSecret})).accessToken;
const original=(await api('/api/reception/driver/updates',dt)).data;
assert.equal(original.driver.id,driver.driverId);assert.equal(original.rides.length,0);
const id=randomUUID();let ot,created=false,locationChanged=false;
try{
 if(original.driver.status!=='Available')await api('/api/reception/driver/availability',dt,'PUT',{status:'Available'});
 const fix={latitude:32.2211,longitude:35.2544,accuracy:10,capturedAt:new Date().toISOString()};
 const stored=await api('/api/reception/driver/location',dt,'PUT',fix);assert.equal(stored.stored,true);locationChanged=true;
 const request={id,pickup:{addressText:'اختبار توزيع مستقل — لا ترسل سيارة',latitude:32.2212,longitude:35.2544,locationSource:'CUSTOMER_GPS'},destination:'وجهة اختبار فقط',destinationLocation:{addressText:'وجهة اختبار',latitude:32.23,longitude:35.27,locationSource:'MAP_PIN'},notes:'اختبار محلي آلي بدون راكب أو دفع'};
 created=true;
 const result=await api('/api/customer/rides',ct,'POST',request);assert.equal(result.rideStatus,'SEARCHING_DRIVER');
 await api('/api/customer/rides',ct,'POST',request);
 const offered=(await api('/api/reception/driver/updates',dt)).data.rides.find(r=>r.id===id);assert.ok(offered);assert.ok(offered.offerDistanceMeters<30);assert.equal(offered.latitude,32.2212);assert.equal(offered.destinationLongitude,35.27);assert.ok(offered.offerExpiresAt);
 const before=await api('/api/customer/updates',ct);
 const waiting=api('/api/customer/updates?cursor='+encodeURIComponent(before.cursor),ct);
 const start=Date.now();await api('/api/reception/rides/'+id+'/status',dt,'PUT',{status:'Accepted',version:offered.version});
 const accepted=(await waiting).rides.find(r=>r.id===id);const customerWakeMs=Date.now()-start;
 assert.equal(accepted.rideStatus,'DRIVER_ASSIGNED');assert.ok(accepted.driver?.fullName);assert.ok(accepted.vehicle?.plate);assert.equal(accepted.tracking.latitude,fix.latitude);
 // The office first authenticates after customer creation and driver acceptance.
 ot=(await api('/api/reception/auth/login',null,'POST',office)).accessToken;
 const snapshot=await call('/api/reception/reception/snapshot',ot);const row=snapshot.data.rides.find(r=>r.id===id);assert.equal(row.driverId,driver.driverId);assert.equal(row.rideStatus,'DRIVER_ASSIGNED');
 const officeWaiting=call('/api/reception/reception/snapshot?wait=true',ot,'GET',undefined,{'If-None-Match':snapshot.etag});
 const current=await api('/api/reception/driver/rides/'+id,dt);const officeStart=Date.now();await api('/api/reception/rides/'+id+'/status',dt,'PUT',{status:'DriverArriving',version:current.version});
 assert.equal((await officeWaiting).data.rides.find(r=>r.id===id).rideStatus,'DRIVER_ARRIVING');const officeWakeMs=Date.now()-officeStart;
 assert.equal((await api('/api/customer/rides/'+id,ct)).rideStatus,'DRIVER_ARRIVING');
 // A changed GPS fix wakes the customer's existing update stream.
 await new Promise(resolve=>setTimeout(resolve,11000));
 const trackingBefore=await api('/api/customer/updates',ct);const trackingWaiting=api('/api/customer/updates?cursor='+encodeURIComponent(trackingBefore.cursor),ct);
 assert.equal((await api('/api/reception/driver/location',dt,'PUT',{...fix,latitude:32.2213,capturedAt:new Date().toISOString()})).stored,true);
 assert.equal((await trackingWaiting).rides.find(r=>r.id===id).tracking.latitude,32.2213);
 assert.equal(sql(`SELECT COUNT(*) FROM "RideOffer" WHERE "RideId"='${id}'`),'1');
 assert.equal(sql(`SELECT "Outcome" FROM "RideOffer" WHERE "RideId"='${id}'`),'ACCEPTED');
 for(const path of ['/customer-mobile/index.html','/driver-mobile/index.html','/office/orders'])assert.equal((await fetch(base+path)).status,200);
 fs.writeFileSync('.dispatchpro-local/independent-customer-live-result.json',JSON.stringify({passed:true,id,customerWakeMs,officeWakeMs,base,customerWithoutOfficeLogin:true,trackingUpdateVerified:true,syntheticGps:true,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({passed:true,id,customerWakeMs,officeWakeMs,independentRequest:true,nearest:true,acceptance:true,trackingUpdate:true}));
}finally{
 if(created){
  ot??=(await api('/api/reception/auth/login',null,'POST',office)).accessToken;
  const row=(await api('/api/reception/reception/snapshot',ot)).rides.find(r=>r.id===id);
  if(row&&!['cancelled','completed'].includes(row.status))await api('/api/reception/reception/rides/'+id,ot,'PUT',{...row,status:'cancelled',dispatchStatus:'CANCELLED'});
  if(row)assert.equal((await api('/api/customer/rides/'+id,ct)).rideStatus,'CANCELLED');
 }
 if(locationChanged){
  if(saved){const p=JSON.parse(saved);assert.match(p.updatedAt,/^[0-9T:+.Z-]+$/);sql(`UPDATE "DriverLocation" SET "Position"=ST_SetSRID(ST_MakePoint(${Number(p.longitude)},${Number(p.latitude)}),4326)::geography,"Accuracy"=${Number(p.accuracy)},"UpdatedAt"='${p.updatedAt}'::timestamptz WHERE ${where}`);}
  else sql(`DELETE FROM "DriverLocation" WHERE ${where}`);
 }
 if(original.driver.status==='Offline')await api('/api/reception/driver/availability',dt,'PUT',{status:'Offline'});
}
