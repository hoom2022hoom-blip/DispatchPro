import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {createAgent,receiverTcp} from '../scripts/officecalls-agent/agent.mjs';
import {normalizePhone} from '../scripts/officecalls-agent/phone.mjs';
const officeId='11111111-1111-1111-1111-111111111111',token='oc3_'+'A'.repeat(64);
const event=()=>({eventId:'test-'+Date.now(),phone:'0591234567',timestamp:new Date().toISOString(),sourcePackage:'com.whatsapp.w4b'});
const response=data=>({ok:true,json:async()=>data});
test('country variants, hidden formatting, foreign and malformed candidates',()=>{
 assert.equal(normalizePhone('+९७२ ५९ १२३ ४५६७'),'0591234567');
 for(const input of ['+972 59 123 4567','+970 59 123 4567','00972 59 123 4567','00970 59 123 4567','059-123-4567','+٩٧٢ ٥٩ ١٢٣ ٤٥٦٧','+۹۷۲ ۵۹ ۱۲۳ ۴۵۶۷',...['\u00a0','\u202f','\u200b','\u200e'].map(s=>`+972${s}59${s}123${s}4567`)])assert.equal(normalizePhone(input),'0591234567',input);
 for(const input of ['+1 591234567','+972 0591234567','059123456','05912345678','0591234567 0561234567','phone 0591234567'])assert.equal(normalizePhone(input),'',input);
});
test('cloud polling delivers once across duplicates, agent restart and lost cloud ACK',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-'));const call=event();let deliveries=0,acks=0,loseAck=true;
 const fetchImpl=async(url,options)=>{if(url.endsWith('/health'))return response({officeId});if(url.endsWith('/devices'))return response({officeId,validUntil:new Date(Date.now()+300000).toISOString(),devices:[]});if(url.endsWith('/agent/events'))return response([call]);if(url.endsWith('/ack')){acks++;if(loseAck){loseAck=false;throw Error('LOST_ACK');}return response({eventId:call.eventId});}throw Error(url);};
 const options={directory,officeId,token,fetchImpl,deliver:async()=>{deliveries++;}};
 await createAgent(options).runOnce();await createAgent(options).runOnce();assert.equal(deliveries,1);assert.equal(acks,2);
});
test('independent GRID path survives reception/cloud failure and signed LAN/cloud paths deduplicate',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-'));const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const deviceId='22222222-2222-2222-2222-222222222222';
 await writeFile(join(directory,'roster.json'),JSON.stringify({officeId,validUntil:new Date(Date.now()+300000).toISOString(),devices:[{id:deviceId,publicKey:publicKey.export({format:'der',type:'spki'}).toString('base64')}]}));
 const call=event(),payload=JSON.stringify(call),envelope={deviceId,payload,signature:sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64')};let deliveries=0;
 let offline=true;const fetchImpl=async(url)=>{if(offline)throw Error('OFFLINE');if(url.endsWith('/health'))return response({officeId});if(url.endsWith('/devices'))return response(JSON.parse(await readFile(join(directory,'roster.json'),'utf8')));if(url.endsWith('/agent/events'))return response([call]);return response({eventId:call.eventId});};
 const agent=createAgent({directory,officeId,token,fetchImpl,deliver:async()=>{deliveries++;}});
 const local=await agent.receiveLocal(envelope);assert.equal(local.receiverAcknowledged,true);assert.equal(local.gridVisibleConfirmed,false);await assert.rejects(agent.runOnce(),/OFFLINE/);assert.equal(deliveries,1);
 offline=false;call.timestamp=call.timestamp.replace('Z','+00:00');await agent.runOnce();assert.equal(deliveries,1);
 await assert.rejects(agent.receiveLocal({...envelope,signature:Buffer.alloc(256).toString('base64')}),/INVALID_DEVICE_SIGNATURE/);
});
test('expired local authorization rejects signed callers; late cloud calls are never broadcast',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-'));await writeFile(join(directory,'roster.json'),JSON.stringify({validUntil:new Date(0).toISOString(),devices:[]}));let deliveries=0;
 const call={...event(),timestamp:new Date(Date.now()-3600000).toISOString()};const fetchImpl=async url=>response(url.endsWith('/health')?{officeId}:url.endsWith('/devices')?{officeId,validUntil:new Date(0).toISOString(),devices:[]}:[call]);
 const agent=createAgent({directory,officeId,token,fetchImpl,deliver:async()=>deliveries++});await assert.rejects(agent.receiveLocal({}),/LOCAL_AUTHORIZATION_EXPIRED/);await agent.runOnce();assert.equal(deliveries,0);
});
test('UDP crash ambiguity is retained and never blindly replayed',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-'));const call=event();const file=join(directory,createHash('sha256').update(call.eventId).digest('hex')+'.json');await writeFile(file,JSON.stringify({officeId,event:call,delivery:'DELIVERY_UNKNOWN',serverAccepted:true}));let deliveries=0;
 const fetchImpl=async url=>response(url.endsWith('/health')?{officeId}:url.endsWith('/devices')?{officeId,devices:[],validUntil:new Date().toISOString()}:[call]);await createAgent({directory,officeId,token,fetchImpl,deliver:async()=>deliveries++}).runOnce();assert.equal(deliveries,0);assert.equal(JSON.parse(await readFile(file)).delivery,'DELIVERY_UNKNOWN');
});
test('receiver failure is reported per destination and a later retry can acknowledge delivery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-')),call=event(),acknowledgments=[];let broken=true;
 const fetchImpl=async(url,options)=>{if(url.endsWith('/health'))return response({officeId});if(url.endsWith('/devices'))return response({officeId,devices:[],validUntil:new Date(Date.now()+300000).toISOString()});if(url.endsWith('/agent/events'))return response([call]);if(url.endsWith('/ack')){acknowledgments.push(JSON.parse(options.body));return response({eventId:call.eventId});}throw Error(url);};
 const agent=createAgent({directory,officeId,token,mode:'tcp',fetchImpl,deliver:async()=>{if(broken)throw Error('RECEIVER_UNAVAILABLE');}});
 await agent.runOnce();assert.equal(acknowledgments[0].status,'FAILED');assert.equal(acknowledgments[0].error,'RECEIVER_UNAVAILABLE');broken=false;await agent.runOnce();assert.ok(acknowledgments.some(a=>a.status==='RECEIVER_ACK'));
});
test('re-paired agent never delivers pending journal data from another office',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-')),call=event();let deliveries=0;
 const fetchOld=async url=>response(url.endsWith('/health')?{officeId}:url.endsWith('/devices')?{officeId,devices:[],validUntil:new Date(Date.now()+300000).toISOString()}:url.endsWith('/agent/events')?[call]:{});
 await createAgent({directory,officeId,token,mode:'tcp',fetchImpl:fetchOld,deliver:async()=>{throw Error('RECEIVER_UNAVAILABLE');}}).runOnce();
 const newOffice='33333333-3333-3333-3333-333333333333';const fetchNew=async url=>response(url.endsWith('/health')?{officeId:newOffice}:url.endsWith('/devices')?{officeId:newOffice,devices:[],validUntil:new Date(Date.now()+300000).toISOString()}:[]);
 await createAgent({directory,officeId:newOffice,token,mode:'tcp',fetchImpl:fetchNew,deliver:async()=>deliveries++}).runOnce();assert.equal(deliveries,0);
});
test('legacy Receiver schema and exact event ACK are preserved over real loopback TCP',async()=>{
 const call=event();let body;const server=createServer(socket=>socket.once('data',data=>{body=JSON.parse(data.toString());socket.end(`OK ${body.eventId}\n`);}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await receiverTcp(call,{port:server.address().port});assert.equal(body.number,call.phone);assert.equal(body.eventId,call.eventId);assert.equal(body.package,'com.whatsapp.w4b');}finally{await new Promise(resolve=>server.close(resolve));}
});

test('cloud failure does not postpone other journal deliveries behind repeated network timeouts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-'));const reports=[];let requests=0,deliveries=0;
 for(let i=0;i<4;i++){
  const call={...event(),eventId:'pending-'+i};
  await writeFile(join(directory,createHash('sha256').update(call.eventId).digest('hex')+'.json'),JSON.stringify({officeId,event:call,envelope:{payload:'saved'},delivery:'PENDING',serverAccepted:false,acknowledged:false}));
 }
 const agent=createAgent({directory,officeId,token,mode:'tcp',deliver:async()=>deliveries++,fetchImpl:async()=>{requests++;throw Error('API_HTTP_530');},report:e=>reports.push(e)});
 await assert.rejects(agent.runOnce(),/API_HTTP_530/);
 assert.equal(deliveries,4,'All independent local deliveries must run despite cloud failure');
 assert.equal(requests,1,'Stop the cloud batch at its first network failure');
});

test('a large pending journal is delivered locally before any slow cloud replay starts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls3-'));let deliveries=0;const snapshots=[];
 for(let i=0;i<3;i++){
  const call={...event(),eventId:'local-priority-'+i};
  await writeFile(join(directory,createHash('sha256').update(call.eventId).digest('hex')+'.json'),JSON.stringify({officeId,event:call,envelope:{payload:'saved'},delivery:'PENDING',serverAccepted:false,acknowledged:false}));
 }
 const agent=createAgent({directory,officeId,token,mode:'tcp',deliver:async()=>deliveries++,fetchImpl:async()=>{snapshots.push(deliveries);throw Error('OFFLINE');}});
 await assert.rejects(agent.runOnce(),/OFFLINE/);
 assert.ok(snapshots.length>0);assert.ok(snapshots.every(value=>value===3));
});
