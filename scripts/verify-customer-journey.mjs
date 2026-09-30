// Local acceptance only: existing test tenant/accounts, actual Next proxy and PostgreSQL.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:9005';
const load=async name=>JSON.parse(await readFile('.dispatchpro-local/'+name,'utf8'));
const office=await load('office-test-account.json'),driver=await load('driver-field-account.json'),customer=await load('customer-mvp-test-account.json');
assert.equal(office.tenant,'office-test-ba6da3f686');assert.equal(driver.tenant,office.tenant);assert.equal(customer.tenant,office.tenant);
async function call(path,token,method='GET',body,extra={}) {
 const response=await fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
 const text=await response.text();assert.ok(response.ok,path+' '+response.status+' '+text.slice(0,250));
 return {data:JSON.parse(text),etag:response.headers.get('etag')};
}
const api=async(...args)=>(await call(...args)).data;
const ot=(await api('/api/reception/auth/login',null,'POST',office)).accessToken;
const dt=(await api('/api/reception/auth/login',null,'POST',driver)).accessToken;
const ct=(await api('/api/customer/register',null,'POST',customer)).accessToken;
const original=await api('/api/reception/driver/updates',dt);
assert.equal(original.data.driver.id,driver.driverId);assert.equal(original.data.rides.length,0,'Do not interrupt an active test driver ride');
assert.equal((await api('/api/reception/dispatch/policy',ot)).mode,'MANUAL','Test must not dispatch to real drivers');
const ids=[],states=[];let officeWakeMs;
const snapshot=()=>api('/api/reception/reception/snapshot',ot);
const find=async id=>(await snapshot()).rides.find(r=>r.id===id);
async function save(id,changes){return api('/api/reception/reception/rides/'+id,ot,'PUT',{...await find(id),...changes});}
async function verify(id,state,dispatch) {
 const detail=await api('/api/customer/rides/'+id,ct);assert.equal(detail.workflowStatus,state);
 const row=await find(id);assert.equal(row.dispatchStatus,dispatch);assert.equal(row.workflowStatus,state);
 states.push(state);
}
async function send(id){await save(id,{driverId:driver.driverId});await save(id,{status:'assigned',dispatchStatus:'SENT',receptionPending:false});await verify(id,'DRIVER_ASSIGNED','SENT');}
async function move(id,status,canonical,dispatch) {
 const current=await api('/api/reception/driver/rides/'+id,dt);
 const before=await api('/api/customer/updates',ct);
 const waiting=api('/api/customer/updates?cursor='+encodeURIComponent(before.cursor),ct);
 await api('/api/reception/rides/'+id+'/status',dt,'PUT',{status,version:current.version});
 assert.equal((await waiting).rides.find(r=>r.id===id).workflowStatus,canonical);
 await verify(id,canonical,dispatch);
}
try {
 await api('/api/reception/driver/availability',dt,'PUT',{status:'Available'});
 const before=await call('/api/reception/reception/snapshot',ot);
 const waiting=call('/api/reception/reception/snapshot?wait=true',ot,'GET',undefined,{'If-None-Match':before.etag});
 const id=randomUUID();ids.push(id);
 const request={id,pickup:{addressText:'اختبار Sprint — لا ترسل سيارة',latitude:32.2211,longitude:35.2544,locationSource:'MAP_PIN'},destination:'وجهة اختبار Sprint',destinationLocation:{addressText:'وجهة اختبار Sprint',latitude:32.23,longitude:35.27,locationSource:'MAP_PIN'},notes:'اختبار آلي محلي فقط، لا يوجد راكب أو تحصيل مالي'};
 const start=Date.now();await api('/api/customer/rides',ct,'POST',request);
 assert.ok((await waiting).data.rides.some(r=>r.id===id));officeWakeMs=Date.now()-start;
 await api('/api/customer/rides',ct,'POST',request);assert.equal((await snapshot()).rides.filter(r=>r.id===id).length,1);
 const created=await find(id);assert.equal(created.latitude,32.2211);assert.equal(created.dropoff.coords.y,35.27);
 await send(id);
 let received=(await api('/api/reception/driver/updates',dt)).data.rides.find(r=>r.id===id);assert.ok(received);
 await api('/api/reception/driver/rides/'+id+'/reject',dt,'PUT',{version:received.version});await verify(id,'REJECTED','REJECTED');
 await send(id);
 for(const args of [['Accepted','ACCEPTED','ACCEPTED'],['DriverArriving','DRIVER_ARRIVING','ARRIVING'],['Arrived','DRIVER_ARRIVED','ARRIVED'],['InProgress','IN_TRIP','STARTED'],['Completed','COMPLETED','COMPLETED']])await move(id,...args);
 assert.ok((await api('/api/reception/driver/history',dt)).items.some(r=>r.id===id));
 assert.ok((await api('/api/customer/history',ct)).items.some(r=>r.id===id));
 const cancelled=randomUUID();ids.push(cancelled);
 await api('/api/customer/rides',ct,'POST',{...request,id:cancelled});await send(cancelled);
 await move(cancelled,'Accepted','ACCEPTED','ACCEPTED');await move(cancelled,'DriverArriving','DRIVER_ARRIVING','ARRIVING');
 await save(cancelled,{status:'cancelled',dispatchStatus:'CANCELLED'});await verify(cancelled,'CANCELLED','CANCELLED');
 const after=(await api('/api/reception/driver/updates',dt)).data;assert.equal(after.rides.length,0);assert.equal(after.driver.status,'Available');
 for(const path of ['/customer-mobile/index.html','/driver-mobile/index.html','/office/reception'])assert.equal((await fetch(base+path)).status,200);
 await writeFile('.dispatchpro-local/customer-journey-live-result.json',JSON.stringify({passed:true,ids,states,officeWakeMs,base,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({passed:true,states,officeWakeMs,completed:id,cancelled}));
} finally {
 for(const id of ids){const row=await find(id);if(row&&!['completed','cancelled'].includes(row.status))await save(id,{status:'cancelled',dispatchStatus:'CANCELLED'});}
 if(original.data.driver.status==='Offline')await api('/api/reception/driver/availability',dt,'PUT',{status:'Offline'});
}
