import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { listenIcall } from '../scripts/lib/icall-udp.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createCentralIcall,validateCentralConfig } from '../scripts/lib/central-icall.mjs';
import { createCallerProcessor } from '../scripts/lib/icall-caller.mjs';

const officeA='11111111-1111-1111-1111-111111111111',officeB='22222222-2222-2222-2222-222222222222';
const packet=(phone='092345678',line='01',phase='S',stamp='10/04 10:00 AM')=>Buffer.from(`${line} I ${phase} 0000 G 01 ${stamp} ${phone.padEnd(15)}${'Caller'.padEnd(15)}`);
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'central-icall-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'credentials.json'),JSON.stringify({username:'bridge',password:'test-only-secret'}));return {root,config:{apiUrl:'https://api.example.test',bindAddress:'127.0.0.1',udpPort:3520,healthPort:0,stateDirectory:'state',sources:[{id:'a',sourceIp:'127.0.0.1',tenant:'a',tenantId:officeA,credentialsFile:'credentials.json'}]}};}
function upstream(){const commits=new Map();let offline=false,lostAck=false,wrongIdentity=false,callerId=true;
 const fetchImpl=async(url,init)=>{
  if(offline)throw Error('offline');
  if(url.endsWith('/auth/login'))return Response.json({accessToken:JSON.parse(init.body).tenant,expiresIn:1800});
  const tenant=init.headers.Authorization.slice(7),id=tenant==='a'?officeA:officeB;
  if(url.endsWith('/me'))return Response.json({tenantId:wrongIdentity?officeB:id});
  if(url.endsWith('/features'))return Response.json([{key:'CallerId',enabled:callerId}]);
  assert.ok(url.endsWith('/bridge/calls'));const body=JSON.parse(init.body);assert.equal(body.tenantId,id);assert.equal(body.source,'LANDLINE');
  const key=id+':'+body.eventId;if(!commits.has(key))commits.set(key,body);
  if(lostAck){lostAck=false;throw Error('lost acknowledgement');}
  return Response.json({eventId:body.eventId});
 };return {fetchImpl,commits,setOffline:x=>offline=x,setLostAck:x=>lostAck=x,setWrongIdentity:x=>wrongIdentity=x,setFeature:x=>callerId=x};}

test('central UDP durable outbox recovers offline/lost ACK/restart and separates offices by configured source',async t=>{
 const {root,config}=await fixture(t),api=upstream();config.sources.push({id:'b',sourceIp:'127.0.0.2',tenant:'b',tenantId:officeB,credentialsFile:'credentials.json'});
 api.setOffline(true);let receiver=await createCentralIcall(config,{configDirectory:root,fetchImpl:api.fetchImpl});
 assert.equal((await receiver.receive(packet(),'127.0.0.1')).accepted,true);await receiver.receive(packet(),'127.0.0.1');await receiver.receive(packet(),'127.0.0.2');
 assert.equal((await receiver.receive(packet(),'127.0.0.3')).reason,'UNCONFIGURED_SOURCE');
 assert.equal((await receiver.receive(Buffer.from('not caller id'),'127.0.0.1')).reason,'UNRECOGNIZED_PROTOCOL');
 await receiver.cycle();assert.equal(receiver.status().sources[0].pending,1);assert.equal(api.commits.size,0);
 api.setOffline(false);api.setLostAck(true);await receiver.cycle();assert.equal(api.commits.size,2);
 receiver=await createCentralIcall(config,{configDirectory:root,fetchImpl:api.fetchImpl});await receiver.cycle();assert.equal(api.commits.size,2);assert.equal(receiver.status().sources[0].pending,0);
 await receiver.receive(packet(),'127.0.0.1');await receiver.cycle();assert.equal(api.commits.size,2);
 await receiver.receive(packet('092345678','01','E'),'127.0.0.1');await receiver.receive(packet(),'127.0.0.1');await receiver.cycle();assert.equal(api.commits.size,3);
 assert.equal(receiver.status().liveCallVerified,false);const status=JSON.stringify(receiver.status());assert.ok(!status.includes('092345678'));assert.ok(!status.includes('test-only-secret'));
 await assert.rejects(createCentralIcall({...config,sources:config.sources.map(s=>({...s,tenantId:officeB}))},{configDirectory:root,fetchImpl:api.fetchImpl}),/different sources/);
});

test('wrong authenticated tenant and disabled CallerId never deliver and expose an actionable status',async t=>{
 const {root,config}=await fixture(t),api=upstream();api.setWrongIdentity(true);const receiver=await createCentralIcall(config,{configDirectory:root,fetchImpl:api.fetchImpl});
 await receiver.receive(packet(),'127.0.0.1');await receiver.cycle();assert.equal(api.commits.size,0);assert.equal(receiver.status().sources[0].upstreamError,'TENANT_IDENTITY_REJECTED');
 api.setWrongIdentity(false);api.setFeature(false);await receiver.cycle();assert.equal(api.commits.size,0);assert.equal(receiver.status().sources[0].upstreamError,'CALLER_ID_DISABLED');
 api.setFeature(true);await receiver.cycle();assert.equal(api.commits.size,1);
 assert.throws(()=>validateCentralConfig({...config,apiUrl:'http://remote.test'}),/HTTPS/);
 assert.throws(()=>validateCentralConfig({...config,sources:[...config.sources,...config.sources]}),/unique/);
});

test('actual UDP socket feeds parser and direct HTTPS bridge; health has no call data and no public local inbox',async t=>{
 const {root,config}=await fixture(t),api=upstream();
 // Reserve no fixed test port; the same source module runs with ephemeral UDP.
 config.udpPort=0;
 const receiver=await createCentralIcall(config,{configDirectory:root,fetchImpl:api.fetchImpl});const endpoint=await receiver.start();
 t.after(()=>receiver.stop());
 const base=`http://127.0.0.1:${endpoint.healthPort}`;assert.equal((await fetch(base+'/status')).status,401);assert.equal((await fetch(base+'/api/calls')).status,404);
 const token=await readFile(join(root,'state/call-token'),'utf8');await receiver.cycle();assert.equal((await fetch(base+'/health/ready')).status,200);
 const sender=createSocket('udp4');await new Promise((resolve,reject)=>sender.send(packet(),endpoint.udpPort,'127.0.0.1',e=>e?reject(e):resolve()));sender.close();
 for(let i=0;i<100&&!receiver.status().sources[0].parsed;i++)await delay(10);
 assert.equal(receiver.status().sources[0].parsed,1);await receiver.cycle();assert.equal(api.commits.size,1);
 const result=await fetch(base+'/status',{headers:{Authorization:`Bearer ${token.trim()}`}});assert.equal(result.status,200);assert.ok(!(await result.text()).includes('092345678'));
});

test('parser persists identity before failed journal write and does not let stale end packets reopen a newer ring',async t=>{
 const {root}=await fixture(t);let fail=true;const events=[];
 const make=()=>createCallerProcessor({directory:join(root,'parser'),sourceIp:'127.0.0.1',send:async e=>{if(fail)throw Error('disk unavailable');events.push(e);}});
 let parser=await make();await parser.receive(packet(),'127.0.0.1');await assert.rejects(parser.retry());const ids=await parser.pendingIds();assert.equal(ids.length,1);
 fail=false;parser=await make();await parser.retry();assert.equal(events[0].eventId,ids[0]);assert.equal(events[0].line,'01');
 await parser.receive(packet('092345678','01','S','10/04 10:01 AM'),'127.0.0.1');await parser.retry();
 await parser.receive(packet('092345678','01','E','10/04 10:00 AM'),'127.0.0.1');await parser.receive(packet('092345678','01','S','10/04 10:01 AM'),'127.0.0.1');await parser.retry();assert.equal(events.length,2);
});

test('field architecture: GridCMS-compatible listener and Receiver both receive the same 83-byte broadcast with reuseAddr',async()=>{
 const grid=createSocket({type:'udp4',reuseAddr:true}),sender=createSocket('udp4');let receiver;
 try{
  grid.bind(0,'0.0.0.0');await once(grid,'listening');const port=grid.address().port;
  let accept;const incoming=new Promise(r=>accept=r);
  receiver=listenIcall({receive:async(data,source)=>{accept({data,source});}},{port,host:'0.0.0.0'});
  await once(receiver,'listening');
  sender.bind(0);await once(sender,'listening');sender.setBroadcast(true);
  const framed=Buffer.concat([Buffer.from('^^<U>'.padEnd(21,' ')),packet()]);assert.equal(framed.length,83);
  const gridMessage=once(grid,'message');
  await new Promise((resolve,reject)=>sender.send(framed,port,'255.255.255.255',e=>e?reject(e):resolve()));
  const received=await Promise.race([Promise.all([gridMessage,incoming]),delay(3000).then(()=>{throw Error('Both shared broadcast listeners must receive the packet');})]);
  assert.deepEqual(received[0][0],framed);assert.deepEqual(received[1].data,framed);assert.equal(received[0][1].address,received[1].source);
 }finally{grid.close();receiver?.close();sender.close();}
});
