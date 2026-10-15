import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createCallStore} from '../src/lib/call-store.ts';
import {createReceptionWorker} from '../scripts/lib/reception-worker.mjs';
test('WhatsApp central HTTPS retains failed calls, retries after restart and checkpoints ACK',async()=>{
 const directory=await mkdtemp(resolve('.dispatchpro-local/whatsapp-central-test-'));
 const tenantId='11111111-1111-1111-1111-111111111111';
 const event={eventId:'real-protocol-fixture',source:'WHATSAPP',phone:'0591234567',timestamp:'2026-10-04T10:00:00Z'};
 await createCallStore(join(directory,'calls')).append(event);
 let fail=true,posts=0;
 const config={directory,apiUrl:'https://api.nablustaxi.com',tenant:'fixture',expectedTenantId:tenantId,username:'fixture',password:'fixture',bridge:true,requiredFeature:'WhatsApp',fetchImpl:async(url,init)=>{
  assert.ok(url.startsWith('https://api.nablustaxi.com/'));
  if(url.endsWith('/auth/login'))return Response.json({accessToken:'fixture',expiresIn:1800});
  if(url.endsWith('/me'))return Response.json({tenantId});
  if(url.endsWith('/features'))return Response.json([{key:'WhatsApp',enabled:true}]);
  assert.ok(url.endsWith('/reception/bridge/calls'));posts++;
  const payload=JSON.parse(init.body);assert.equal(payload.tenantId,tenantId);assert.equal(payload.source,'WHATSAPP');assert.equal(payload.eventId,event.eventId);
  return fail?new Response('',{status:503}):Response.json({eventId:event.eventId});
 }};
 assert.equal((await createReceptionWorker(config).runOnce()).failed,1);
 fail=false;
 assert.equal((await createReceptionWorker(config).runOnce()).delivered,1);
 assert.equal((await createReceptionWorker(config).runOnce()).delivered,0);
 assert.equal(posts,2);
 await assert.rejects(createReceptionWorker({...config,expectedTenantId:'22222222-2222-2222-2222-222222222222'}).runOnce(),/identity/);
});
