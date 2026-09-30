import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCallStore } from '../src/lib/call-store.ts';
import { createOfficeBridge, bridgeLogger } from '../scripts/lib/office-bridge.mjs';

test('office bridge retains offline calls, survives restart/lost ACK, filters sources, pins tenant and leaves source unchanged', async () => {
 const root=await mkdtemp(join(tmpdir(),'office-bridge-'));
 try {
  const source=join(root,'source');const store=createCallStore(source);
  const event={eventId:'landline-1',source:'LANDLINE_ICALL',phone:'0591234567',timestamp:'2026-09-27T12:00:00.000Z'};
  await store.append(event);await store.append({...event,eventId:'wa-1',source:'WHATSAPP'});await store.append({...event,eventId:'manual',source:'MANUAL'});
  const before=await Promise.all((await readdir(source)).map(async file=>[file,await readFile(join(source,file),'utf8')]));
  const office='11111111-1111-1111-1111-111111111111';let offline=true,lost=true,identity=office;const committed=new Set();let sends=0;
  const fetchImpl=async(url,init)=>{
   if(offline)throw Error('secret phone password must not be logged');
   if(url.endsWith('/auth/login'))return Response.json({accessToken:'secret',expiresIn:1800});
   if(url.endsWith('/me'))return Response.json({tenantId:identity});
   assert.ok(url.endsWith('/bridge/calls'));const body=JSON.parse(init.body);assert.equal(body.tenantId,office);assert.ok(['LANDLINE','WHATSAPP'].includes(body.source));assert.equal(body.callerNumber,event.phone);assert.equal(body.receivedAt,event.timestamp);sends++;committed.add(body.eventId);
   if(lost){lost=false;throw Error('lost ACK');}return Response.json({eventId:body.eventId});
  };
  const config={apiUrl:'https://api.example.test',tenant:'office',tenantId:office,sourceDirectory:source,stateDirectory:join(root,'state'),startAfter:'2020-01-01T00:00:00Z'};
  const reports=[];const make=()=>createOfficeBridge(config,{username:'worker',password:'secret'},{fetchImpl,report:r=>reports.push(r)});
  assert.equal((await make().runOnce()).imported,2);offline=false;
  assert.equal((await make().runOnce()).failed,1);assert.equal((await make().runOnce()).delivered,1);assert.equal((await make().runOnce()).delivered,0);assert.equal(committed.size,2);assert.equal(sends,3);
  identity='22222222-2222-2222-2222-222222222222';assert.equal((await make().runOnce()).failed,1);assert.equal(sends,3);
  await assert.rejects(()=>createOfficeBridge({...config,tenantId:identity},{username:'worker',password:'secret'},{fetchImpl}).runOnce(),/different office/);
  assert.deepEqual(await Promise.all((await readdir(source)).map(async file=>[file,await readFile(join(source,file),'utf8')])),before);
  assert.ok(!JSON.stringify(reports).includes('secret'));assert.ok(!JSON.stringify(reports).includes(event.phone));
  const logger=await bridgeLogger(join(root,'log'));await logger({type:'retry',password:'secret',phone:event.phone,error:'sensitive'});const logs=await readFile(join(root,'log','agent.log'),'utf8');assert.ok(!logs.includes('secret'));assert.ok(!logs.includes(event.phone));
  assert.throws(()=>createOfficeBridge({...config,apiUrl:'http://remote.test'}, {username:'u',password:'p'}),/HTTPS/);
 } finally {await rm(root,{recursive:true,force:true});}
});
