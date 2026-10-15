import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {createServer,connect} from 'node:net';
import {mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import {createOfficeCallsTcpReceiver} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs';
import {sendOfficeMirror,officeMirrorPayload} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';
import {createOfficeBridge} from '../DispatchPro-Site-Bridge/scripts/lib/office-bridge.mjs';
import {createCallerProcessor} from '../DispatchPro-Site-Bridge/app/scripts/lib/icall-caller.mjs';

test('WhatsApp mirrors the old office protocol once without a second central order',async()=>{
 const root=await mkdtemp(resolve('.dispatchpro-local/mirror-check-'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const config={siteId:'mirror-test',officeId:'11111111-1111-1111-1111-111111111111',tenantId:'11111111-1111-1111-1111-111111111111',whatsappTcpPort:port,apiUrl:'https://api.example.test',tenant:'test',sourceDirectory:join(root,'calls'),stateDirectory:join(root,'bridge'),startAfter:'2000-01-01T00:00:00Z'};
 const udp=createSocket('udp4');udp.bind(0,'127.0.0.1');await once(udp,'listening');
 const packets=[];udp.on('message',packet=>packets.push(packet));
 const mirror=event=>sendOfficeMirror(event,{host:'127.0.0.1',port:udp.address().port});
 const logs=[];let receiver;
 const make=()=>createOfficeCallsTcpReceiver(config,{directory:config.sourceDirectory,host:'127.0.0.1',mirror,report:r=>logs.push(r.type)});
 const payload={eventId:'same-ring',type:'incoming_call',number:'0591234567',timestamp:Date.now()};
 const send=()=>new Promise((res,rej)=>{const socket=connect(port,'127.0.0.1');let reply='';socket.setTimeout(3000,()=>socket.destroy(Error('timeout')));socket.on('error',rej);socket.on('connect',()=>socket.write(JSON.stringify(payload)+'\n'));socket.on('data',data=>reply+=data);socket.on('end',()=>res(reply));});
 try{
  const reference=officeMirrorPayload(payload.number,new Date(2026,8,28,15,7));
  assert.equal(reference.length,83);assert.equal(reference.subarray(0,21).toString('hex'),'5e5e3c553e0000000000013c533e17001607186024');
  assert.equal(reference.subarray(21).toString('ascii'),'04 I S 0000 G B1 09/28 03:07 PM 059-123-4567   0591234567     ');
  receiver=make();await receiver.listen();const received=once(udp,'message',{signal:AbortSignal.timeout(3000)});
  assert.equal(await send(),'OK same-ring\n');await received;
  await Promise.all([send(),send()]);await receiver.close();receiver=make();await receiver.listen();await send();
  assert.equal(packets.length,1);assert.ok(logs.includes('whatsapp_office_mirrored'));
  let recaptured=0;const caller=await createCallerProcessor({directory:join(root,'icall'),send:async()=>recaptured++});
  assert.equal(await caller.receive(packets[0],'192.168.0.105'),null);await caller.retry();assert.equal(recaptured,0);
  const sent=[];const bridge=createOfficeBridge(config,{username:'u',password:'p'},{fetchImpl:async(url,init)=>{if(url.endsWith('/auth/login'))return Response.json({accessToken:'test',expiresIn:1800});if(url.endsWith('/me'))return Response.json({tenantId:config.tenantId});const body=JSON.parse(init.body);sent.push(body);return Response.json({eventId:body.eventId});}});
  assert.equal((await bridge.runOnce()).delivered,1);assert.equal((await bridge.runOnce()).delivered,0);assert.equal(sent.length,1);assert.equal(sent[0].source,'WHATSAPP');assert.equal(sent[0].eventId,payload.eventId);
 }finally{if(receiver?.server.listening)await receiver.close();udp.close();}
});
