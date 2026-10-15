import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi} from '../src/lib/driver-api.ts';

for(const skew of [300000,-300000])test(`GPS preserves fix age when phone clock differs by ${skew}ms`,async()=>{
 const calls=[],phone=Date.now(),server=phone-skew;
 const api=createDriverApi(async(url,init)=>{
  if(url.endsWith('auth/driver-login'))return Response.json({accessToken:'test'});
  if(url.endsWith('driver/me'))return Response.json({id:'driver'});
  calls.push(JSON.parse(init.body));
  return calls.length===1?Response.json({error:skew>0?'FUTURE_LOCATION':'STALE_LOCATION',serverTime:new Date(server).toISOString()},{status:400}):Response.json({stored:true});
 });
 await api.login('office','driver','password');
 const fix={latitude:32.22,longitude:35.25,accuracy:20,capturedAt:new Date(phone-5000).toISOString()};
 assert.equal((await api.location(fix)).stored,true);
 assert.equal(calls.length,2);
 assert.ok(Math.abs(Date.parse(calls[1].capturedAt)-(server-5000))<1000);
 assert.equal(calls[1].latitude,fix.latitude);assert.equal(calls[1].accuracy,fix.accuracy);
 await api.location({...fix,capturedAt:new Date(phone).toISOString()});
 assert.equal(calls.length,3);assert.ok(Math.abs(Date.parse(calls[2].capturedAt)-server)<1000);
});

for(const reason of ['STALE_LOCATION','POOR_ACCURACY'])test(`GPS does not conceal ${reason}`,async()=>{
 let calls=0;
 const api=createDriverApi(async(url)=>url.endsWith('auth/driver-login')?Response.json({accessToken:'test'}):url.endsWith('driver/me')?Response.json({id:'driver'}):(calls++,Response.json({error:reason,serverTime:new Date().toISOString()},{status:400})));
 await api.login('office','driver','password');
 await assert.rejects(()=>api.location({latitude:32.22,longitude:35.25,accuracy:reason==='POOR_ACCURACY'?500:20,capturedAt:new Date(Date.now()-(reason==='STALE_LOCATION'?120000:0)).toISOString()}),e=>e.message===reason);
 assert.equal(calls,1);
});
