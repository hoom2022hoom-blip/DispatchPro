import test from 'node:test';
import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createOfficeCallsTcpReceiver,parseOfficeCall} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs';
import {createOfficeBridge} from '../DispatchPro-Site-Bridge/scripts/lib/office-bridge.mjs';

test('OfficeCalls TCP 5050 protocol, durable dedup and existing Bridge forwarding',async()=>{
 const root=await mkdtemp(resolve('.dispatchpro-local/site-tcp-check-'));
 const config={siteId:'site-test',officeId:'11111111-1111-1111-1111-111111111111',tenantId:'11111111-1111-1111-1111-111111111111',whatsappTcpPort:5050,apiUrl:'https://api.example.test',tenant:'test',sourceDirectory:join(root,'calls'),stateDirectory:join(root,'bridge'),startAfter:'2000-01-01T00:00:00Z'};
 const payload={eventId:'ring-123',type:'incoming_call',number:'+970 59-1234567',caller:'name',package:'com.whatsapp.w4b',timestamp:1790622000000,device:'OfficeCalls'};
 const exchange=(value,split=false)=>new Promise((res,rej)=>{const socket=connect(5050,'127.0.0.1');let response='';socket.setTimeout(3000,()=>socket.destroy(Error('timeout')));socket.on('error',rej);socket.on('data',v=>response+=v);socket.on('end',()=>res(response));socket.on('connect',()=>{const line=JSON.stringify(value)+'\r\n';if(split){socket.write(line.slice(0,17));setTimeout(()=>socket.write(line.slice(17)),10);}else socket.write(line);});});
 let receiver=createOfficeCallsTcpReceiver(config,{directory:config.sourceDirectory,host:'127.0.0.1',mirror:async()=>{}});
 await receiver.listen();
 try{
  assert.equal(await exchange(payload,true),'OK ring-123\n');assert.equal(await exchange(payload),'OK ring-123\n');
  const files=await readdir(config.sourceDirectory);assert.equal(files.length,1);
  const stored=JSON.parse(await readFile(join(config.sourceDirectory,files[0]),'utf8')).event;
  assert.equal(stored.phone,'0591234567');assert.equal(stored.source,'WHATSAPP');assert.equal(stored.siteId,config.siteId);assert.equal(stored.officeId,config.officeId);
  await receiver.close();receiver=createOfficeCallsTcpReceiver(config,{directory:config.sourceDirectory,host:'127.0.0.1',mirror:async()=>{}});await receiver.listen();assert.equal(await exchange(payload),'OK ring-123\n');
  const sent=[];const bridge=createOfficeBridge(config,{username:'u',password:'p'},{fetchImpl:async(url,init)=>{if(url.endsWith('/auth/login'))return Response.json({accessToken:'test',expiresIn:1800});if(url.endsWith('/me'))return Response.json({tenantId:config.tenantId});assert.ok(url.endsWith('/api/v1/reception/bridge/calls'));const body=JSON.parse(init.body);sent.push(body);return Response.json({eventId:body.eventId});}});
  assert.equal((await bridge.runOnce()).delivered,1);assert.equal((await bridge.runOnce()).delivered,0);assert.equal(sent.length,1);assert.equal(sent[0].source,'WHATSAPP');assert.equal(sent[0].siteId,config.siteId);assert.equal(sent[0].officeId,config.officeId);assert.equal(sent[0].callerNumber,stored.phone);
  assert.equal(parseOfficeCall({...payload,number:'',caller:'00972591234567'},config).phone,'0591234567');
  assert.throws(()=>parseOfficeCall({...payload,number:'name 123'},config));
  assert.equal(await exchange({...payload,eventId:'ring-124',package:'com.whatsapp'}),'OK ring-124\n');assert.equal((await bridge.runOnce()).delivered,1);
 }finally{if(receiver.server.listening)await receiver.close();}
});
