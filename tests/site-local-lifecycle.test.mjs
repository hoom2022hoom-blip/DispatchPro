import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createOfficeCallsTcpReceiver} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs';
import {createOfficeBridge} from '../DispatchPro-Site-Bridge/scripts/lib/office-bridge.mjs';

test('Local portable receiver: same ring once, new ring same number, offline retry and optional mirror',async()=>{
 const root=await mkdtemp(resolve('.dispatchpro-local/site-final-check-'));
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const config={mode:'local-whatsapp',siteId:'local-test',officeId:'11111111-1111-1111-1111-111111111111',tenantId:'11111111-1111-1111-1111-111111111111',whatsappTcpPort:port,requireEventId:true,mirror:{enabled:false},apiUrl:'http://127.0.0.1:9010',tenant:'local-test',sourceDirectory:join(root,'calls'),stateDirectory:join(root,'bridge'),startAfter:'2000-01-01T00:00:00Z'};
 const logs=[];let receiver=createOfficeCallsTcpReceiver(config,{directory:config.sourceDirectory,host:'127.0.0.1',report:e=>logs.push(e.type)});
 const payload={eventId:'ring-a',type:'incoming_call',number:'0591234567',timestamp:Date.now()};
 const send=p=>new Promise((res,rej)=>{let reply='';const s=connect(port,'127.0.0.1');s.setTimeout(3000,()=>s.destroy(Error('timeout')));s.on('error',rej);s.on('connect',()=>s.write(JSON.stringify(p)+'\n'));s.on('data',v=>reply+=v);s.on('end',()=>res(reply));});
 let offline=true;const sent=[];
 const bridge=createOfficeBridge(config,{username:'local',password:'test'},{fetchImpl:async(url,init)=>{if(offline)throw Error('API offline');if(url.endsWith('/auth/login'))return Response.json({accessToken:'test',expiresIn:1800});if(url.endsWith('/me'))return Response.json({tenantId:config.tenantId});assert.ok(url.endsWith('/reception/calls'));const body=JSON.parse(init.body);sent.push(body);return Response.json({eventId:body.eventId});}});
 await receiver.listen();
 try{
  assert.equal(await send(payload),'OK ring-a\n');
  await Promise.all([send({...payload,timestamp:payload.timestamp+1}),send(payload)]);
  assert.equal((await readdir(config.sourceDirectory)).length,1);
  assert.equal((await bridge.runOnce()).failed,1);
  await receiver.close();receiver=createOfficeCallsTcpReceiver(config,{directory:config.sourceDirectory,host:'127.0.0.1'});await receiver.listen();
  assert.equal(await send({...payload,timestamp:payload.timestamp+2}),'OK ring-a\n');
  assert.equal(await send({...payload,eventId:'ring-b'}),'OK ring-b\n');
  offline=false;assert.equal((await bridge.runOnce()).delivered,2);assert.equal((await bridge.runOnce()).delivered,0);assert.equal(sent.length,2);assert.equal(sent[0].phone,sent[1].phone);assert.notEqual(sent[0].eventId,sent[1].eventId);
  assert.ok(!logs.some(s=>s.startsWith('whatsapp_office_')));
  await receiver.close();receiver=createOfficeCallsTcpReceiver(config,{directory:config.sourceDirectory,host:'127.0.0.1',mirror:async()=>{throw Error('Mirror down');}});await receiver.listen();
  assert.equal(await send({...payload,eventId:'ring-c'}),'OK ring-c\n');assert.equal((await bridge.runOnce()).delivered,1);
 }finally{if(receiver.server.listening)await receiver.close();}
});
