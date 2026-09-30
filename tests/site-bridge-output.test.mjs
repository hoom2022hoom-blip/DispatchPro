import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {createOfficeOutputReceiver,parseOfficeOutput} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-output.mjs';
import {officeMirrorPayload,sendOfficeMirror} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';
import {listenRaw} from '../DispatchPro-Site-Bridge/app/scripts/lib/icall-raw.mjs';
import {createOfficeBridge} from '../DispatchPro-Site-Bridge/scripts/lib/office-bridge.mjs';

test('Office Calls UDP output enters existing inbox once; own mirrors cannot loop',async()=>{
 const root=await mkdtemp(resolve('.dispatchpro-local/office-output-test-'));
 const config={siteId:'test',officeId:'11111111-1111-1111-1111-111111111111',tenantId:'11111111-1111-1111-1111-111111111111',tenant:'test',apiUrl:'https://api.example.test',sourceDirectory:join(root,'calls'),stateDirectory:join(root,'state'),startAfter:'2000-01-01T00:00:00Z'};
 const make=()=>createOfficeOutputReceiver(config,{directory:config.sourceDirectory,localAddresses:['127.0.0.1']});
 let receiver=make();const tasks=[];
 const udp=listenRaw({port:0,host:'127.0.0.1',persist:false,output:()=>{},onPacket:(packet,ip)=>{const task=receiver.receive(packet,ip);tasks.push(task);return task;},onError:e=>{throw e;}});
 await once(udp,'listening');const sender=createSocket('udp4');
 const packet=officeMirrorPayload('0591234567');
 const send=async p=>{const received=once(udp,'message');await new Promise((r,j)=>sender.send(p,udp.address().port,'127.0.0.1',e=>e?j(e):r()));await received;await new Promise(r=>setImmediate(r));await Promise.all(tasks);};
 try{
  assert.equal(parseOfficeOutput(packet),'0591234567');assert.equal(await receiver.receive(packet,'192.168.0.90'),null);
  const invalid=Buffer.from(packet);invalid[21]=0x30;invalid[22]=0x31;assert.equal(parseOfficeOutput(invalid),null);
  await send(packet);await send(packet);receiver=make();await send(packet);
  const files=await readdir(config.sourceDirectory);assert.equal(files.length,1);const event=JSON.parse(await readFile(join(config.sourceDirectory,files[0]),'utf8')).event;assert.equal(event.source,'WHATSAPP');assert.equal(event.officeId,config.officeId);
  const received=once(udp,'message');await sendOfficeMirror({phone:'0597654321',eventId:'tcp-ring'},{host:'127.0.0.1',port:udp.address().port,directory:config.sourceDirectory});await received;await new Promise(r=>setImmediate(r));await Promise.all(tasks);assert.equal((await readdir(config.sourceDirectory)).length,1);
  const sent=[];const bridge=createOfficeBridge(config,{username:'u',password:'p'},{fetchImpl:async(url,init)=>{if(url.endsWith('/auth/login'))return Response.json({accessToken:'test',expiresIn:1800});if(url.endsWith('/me'))return Response.json({tenantId:config.tenantId});sent.push(JSON.parse(init.body));return Response.json({eventId:sent.at(-1).eventId});}});
  assert.equal((await bridge.runOnce()).delivered,1);assert.equal((await bridge.runOnce()).delivered,0);assert.equal(sent.length,1);assert.equal(sent[0].source,'WHATSAPP');
 }finally{sender.close();udp.close();}
});
