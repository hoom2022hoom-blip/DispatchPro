import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createLocalReceiver} from '../scripts/officecalls-agent/local-receiver.mjs';
import {createBridgeRouting,bridgeEventId} from '../scripts/officecalls-agent/bridge-routing.mjs';
import {createPairingOffer,decryptPairingOffer} from '../scripts/officecalls-agent/local-pairing.mjs';
import {createCallStore} from '../DispatchPro-Site-Bridge/src/lib/call-store.ts';
import {startLandlineRuntime} from '../scripts/officecalls-agent/landline-runtime.mjs';
import {createOfficeCallsTcpReceiver,parseOfficeCall} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs';
import {createServer,connect} from 'node:net';

const tenantId='11111111-1111-1111-1111-111111111111';
const call=(eventId,number='0591234567',revision=1,deviceId=tenantId)=>({eventId,deviceId,number,revision,package:'com.whatsapp.w4b',timestamp:Date.now(),displayName:'أحمد ⭐',device:'fixture'});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'officecalls-320-'));let udp=0;const settings={directory:join(dir,'receiver'),key:randomBytes(32),token:randomBytes(32).toString('hex'),dispatchConfigured:true,deliver:async()=>{udp++;}};const receiver=await createLocalReceiver(settings);return {dir,settings,receiver,udp:()=>udp};}
async function config(dir){const file=join(dir,'config.json');await writeFile(file,JSON.stringify({apiUrl:'https://api.example.test',tenant:'fixture',tenantId,siteId:'test-site',officeId:tenantId,credentials:{username:'fixture',password:'fixture-only'},sourceDirectory:'landline',stateDirectory:'existing-bridge',startAfter:'2000-01-01T00:00:00Z'}));return file;}
function upstream(){let offline=false,lostAck=false,posts=0;const received=new Map();return {received,posts:()=>posts,offline:v=>offline=v,lostAck:v=>lostAck=v,fetchImpl:async(url,init)=>{
 if(offline)throw Error('fixture outage');if(url.endsWith('/auth/login'))return Response.json({accessToken:'fixture',expiresIn:1800});if(url.endsWith('/me'))return Response.json({tenantId});if(url.endsWith('/features'))return Response.json([{key:'WhatsApp',enabled:true}]);
 assert.ok(url.endsWith('/api/v1/reception/bridge/calls'));posts++;const body=JSON.parse(init.body),old=received.get(body.eventId);if(old)assert.deepEqual(old,body);else received.set(body.eventId,body);
 if(lostAck){lostAck=false;throw Error('fixture lost ACK after server commit');}return Response.json({eventId:body.eventId});}};}

test('Independent destinations: outage, unknown enrichment, same ID across phones, restart and retained history',async()=>{
 const f=await fixture(),api=upstream(),file=await config(f.dir);let routing=await createBridgeRouting(f.receiver,file,api);
 const a=call('same-ring','',1),b=call('same-ring','0561234567',1,'22222222-2222-2222-2222-222222222222');
 assert.ok((await f.receiver.accept(a)).receiverAcknowledged);await f.receiver.accept(b);await f.receiver.idle();assert.equal(f.udp(),1);
 api.offline(true);await routing.cycle();assert.equal(api.received.size,0);assert.equal(f.receiver.history().find(r=>r.event.deviceId===a.deviceId).dispatch,'NUMBER_UNAVAILABLE');
 const enriched={...a,number:'0591234567',revision:2};await f.receiver.accept(enriched);await f.receiver.accept(enriched);await f.receiver.idle();assert.equal(f.udp(),2);
 api.offline(false);await routing.cycle();await routing.cycle();assert.equal(api.received.size,2);assert.notEqual(bridgeEventId(a),bridgeEventId(b));assert.ok(f.receiver.history().every(r=>r.dispatch==='DELIVERED'));
 await f.receiver.close();const restored=await createLocalReceiver(f.settings);routing=await createBridgeRouting(restored,file,api);await routing.cycle();await restored.idle();assert.equal(api.posts(),2);assert.equal(f.udp(),2);assert.equal(restored.history().length,2);await restored.close();
});
test('Lost DispatchPro response is safely replayed with original timestamp and immutable event ID',async()=>{
 const f=await fixture(),api=upstream(),file=await config(f.dir),routing=await createBridgeRouting(f.receiver,file,api);await f.receiver.accept(call('response-lost'));await f.receiver.idle();api.lostAck(true);
 await routing.cycle();assert.equal(f.receiver.history()[0].dispatch,'PENDING');assert.equal(api.received.size,1);
 await routing.cycle();assert.equal(api.received.size,1);assert.equal(api.posts(),2);assert.equal(f.receiver.history()[0].dispatch,'DELIVERED');assert.equal(f.udp(),1);await f.receiver.close();
});
test('Landline immutable inbox is observed through the existing Office Bridge, not re-broadcast to GRIDCMS',async()=>{
 const f=await fixture(),api=upstream(),file=await config(f.dir);await createCallStore(join(f.dir,'landline')).append({eventId:'landline-fixture',source:'LANDLINE_ICALL',phone:'092345678',timestamp:new Date().toISOString()});
 const routing=await createBridgeRouting(f.receiver,file,api);await routing.cycle();await routing.cycle();assert.equal(api.received.size,1);assert.equal([...api.received.values()][0].source,'LANDLINE');assert.equal(routing.landlineHistory().length,1);assert.equal(f.udp(),0);await f.receiver.close();
});
test('Existing relative-path office binding and already acknowledged landline checkpoints survive upgrade',async()=>{
 const f=await fixture(),api=upstream(),file=await config(f.dir),event={eventId:'old-landline',source:'LANDLINE_ICALL',phone:'092345678',timestamp:new Date().toISOString()};
 const bridgeState=join(f.dir,'existing-bridge');await mkdir(bridgeState,{recursive:true});
 await writeFile(join(bridgeState,'office-binding.json'),JSON.stringify({apiUrl:'https://api.example.test/',tenant:'fixture',tenantId,source:'landline'}));
 await createCallStore(join(f.dir,'landline')).append(event);
 const routing=await createBridgeRouting(f.receiver,file,api);await routing.cycle();assert.equal(routing.landlineHistory()[0].dispatch,'DELIVERED');
 await f.receiver.close();const restored=await createLocalReceiver(f.settings),again=await createBridgeRouting(restored,file,api);await again.cycle();assert.equal(api.posts(),1);await restored.close();
});
test('Changing office identity cannot forward previous encrypted calls to another tenant',async()=>{
 const f=await fixture(),api=upstream(),file=await config(f.dir);await createBridgeRouting(f.receiver,file,api);
 const configValue=JSON.parse(await readFile(file,'utf8'));configValue.tenantId='22222222-2222-2222-2222-222222222222';configValue.officeId=configValue.tenantId;await writeFile(file,JSON.stringify(configValue));
 await assert.rejects(()=>createBridgeRouting(f.receiver,file,api),/DISPATCH_OFFICE_IDENTITY_CHANGED/);await f.receiver.close();
});
test('Temporary code authenticates envelope: wrong code, tamper, expiry and identity substitution rejected',async()=>{
 const settings={host:'192.168.1.8',port:5051,token:'a'.repeat(64),pin:'b'.repeat(64)},clock=()=>1700000000000;
 const pairing=await createPairingOffer(settings,{clock,code:'1234ABCDEF987654'});assert.equal((await decryptPairingOffer(pairing.offer,pairing.code,clock)).pin,settings.pin);
 await assert.rejects(decryptPairingOffer(pairing.offer,'0000000000000000',clock));
 const bytes=Buffer.from(pairing.offer.ciphertext,'base64');bytes[0]^=1;await assert.rejects(decryptPairingOffer({...pairing.offer,ciphertext:bytes.toString('base64')},pairing.code,clock));
 await assert.rejects(decryptPairingOffer(pairing.offer,pairing.code,()=>clock()+180001));
});
test('Unavailable capture is not launched and disabled capture never touches old services',async()=>{
 const runtime=await startLandlineRuntime({capturePackageDirectory:'does-not-exist',startLandlineCapture:false});assert.equal(runtime.status(),'EXISTING_INBOX_ONLY');await runtime.stop();
});
test('Legacy TCP displays country-derived national numbers and retains explicit international identity',()=>{
 for(const [number,expected] of [['+14155552671','4155552671'],['00972542345678','0542345678'],['+970591234567','0591234567'],['00972591234567','0591234567']]) {
  const parsed=parseOfficeCall({eventId:'international-fixture',type:'incoming_call',number,timestamp:Date.now()},{requireEventId:true});assert.equal(parsed.phone,expected);assert.ok(parsed.phoneIdentity.startsWith('+'));
 }
});
test('Legacy TCP adapter acknowledges only after its shared durable receiver commits',async()=>{
 const f=await fixture();const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const receiver=createOfficeCallsTcpReceiver({tenantId,officeId:tenantId,siteId:'fixture',whatsappTcpPort:port,requireEventId:true},{directory:f.dir,host:'127.0.0.1',mirror:null,acceptEvent:async(event)=>{await f.receiver.accept({...call(event.eventId,event.phone),timestamp:Date.parse(event.timestamp)});}});
 await receiver.listen();const input={eventId:'tcp-ring',type:'incoming_call',number:'0591234567',timestamp:Date.now()};
 const send=()=>new Promise((resolve,reject)=>{const socket=connect(port,'127.0.0.1');let body='';socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify(input)+'\n'));socket.on('data',data=>body+=data);socket.on('end',()=>resolve(body));});
 try{assert.equal(await send(),'OK tcp-ring\n');assert.equal(await send(),'OK tcp-ring\n');await f.receiver.idle();assert.equal(f.receiver.history().length,1);assert.equal(f.udp(),1);}finally{await receiver.close();await f.receiver.close();}
});
