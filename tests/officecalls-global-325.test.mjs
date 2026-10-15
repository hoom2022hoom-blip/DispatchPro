import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createSocket} from 'node:dgram';
import {createConnection,createServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {request} from 'node:https';
import {X509Certificate} from 'node:crypto';
import {parsePhone,normalizePhone,gridPhone} from '../scripts/officecalls-agent/phone.mjs';
import {createLocalReceiver} from '../scripts/officecalls-agent/local-receiver.mjs';
import {officeMirrorPayload,sendOfficeMirror} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';
import {parseOfficeOutput} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-output.mjs';
import {createOfficeCallsTcpReceiver,parseOfficeCall} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs';

const numbers=[['+972521234567','0521234567'],['+970592081197','0592081197'],['+966501234567','0501234567'],
 ['+12025550123','2025550123'],['+442079460018','02079460018'],['+33142345678','0142345678'],['+39066982','066982'],
 ['+819012345678','09012345678'],['+8613812345678','13812345678'],['+919876543210','09876543210'],['+5511987654321','11987654321']];
const identity={siteId:'office-fixture',officeId:'office-fixture',tenantId:'office-fixture',requireEventId:true};
const event=(phone,extra={})=>({eventId:randomUUID(),deviceId:randomUUID(),revision:1,package:'com.whatsapp.w4b',timestamp:Date.now(),number:phone,...extra});
const config=async(extra={})=>({directory:await mkdtemp(join(tmpdir(),'officecalls-global-325-')),key:randomBytes(32),token:'a'.repeat(64),...extra});

test('required numbers plus Arab, European, American and Asian national formats',()=>{
 for(const [international,local] of numbers){const p=parsePhone(international);assert.equal(p.e164,international);assert.equal(p.display,local);assert.equal(normalizePhone(international),local);}
});
test('unknown local country retains digits and 00 follows the origin dialling metadata',()=>{
 for(const n of ['0521234567','970592081197','5201234567','612345','12345678901234567'])assert.deepEqual(parsePhone(n),{identity:n,display:n,e164:'',reason:'LOCAL_REGION_UNKNOWN'});
 assert.equal(parsePhone('00442079460018').e164,'+442079460018');assert.equal(parsePhone('00442079460018','US').display,'00442079460018');
 assert.equal(parsePhone('\u200f+٩٧٠ (٥٩) ٢٠٨-١١٩٧').e164,'+970592081197');
 for(const n of ['12','+12','words 0591234567','0591234567 0561234567','tel:+970591234567;ext=4','0'.repeat(10),'1'.repeat(31)])assert.equal(parsePhone(n),null,n);
 assert.equal(parsePhone('+9720591234567').display,'+9720591234567');assert.equal(parsePhone('+999123456789').e164,'');
});
test('Android metadata fixtures cover all calling codes and agree with Windows national display',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('../artifacts/officecalls-global-20261013/android-phone-fixtures.json',import.meta.url),'utf8'));
 assert.ok(fixtures.length>=240);
 for(const row of fixtures){const p=parsePhone(row.international);assert.equal(p.e164,row.international,row.region);assert.equal(p.display,row.local,`${row.region}: ${row.international}`);}
});
test('GRID keeps the legacy 83 bytes, line 04 and complete digits for every representable world fixture',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('../artifacts/officecalls-global-20261013/android-phone-fixtures.json',import.meta.url),'utf8'));
 for(const row of fixtures){if(row.local.length>15||row.local.startsWith('+'))continue;const packet=officeMirrorPayload(row.local);assert.equal(packet.length,83);assert.equal(packet.subarray(21,23).toString(),'04');assert.equal(parseOfficeOutput(packet),row.local,row.region);}
});
test('unrepresentable or unverified identities never become truncated GRID packets',()=>{
 assert.throws(()=>officeMirrorPayload('1234567890123456'),/GRID_PHONE_TOO_LONG/);
 assert.throws(()=>officeMirrorPayload('+999123456789'),/GRID_PHONE_UNVERIFIED/);
 assert.throws(()=>gridPhone('abc0591234567'),/GRID_PHONE_INVALID/);
 assert.equal(parseOfficeOutput(officeMirrorPayload('123456789012345')),'123456789012345');
});
test('Windows keeps both country identities even when their local displays match',async()=>{
 const receiver=await createLocalReceiver(await config({deliver:async()=>{}}));
 try {for(const n of ['+970591234567','+972591234567'])await receiver.accept(event(n));await receiver.idle();
  const history=receiver.history();assert.equal(history.length,2);assert.equal(history[0].event.number,history[1].event.number);assert.notEqual(history[0].event.phoneIdentity,history[1].event.phoneIdentity);
  await assert.rejects(receiver.accept({...history[0].event,revision:2,phoneIdentity:history[1].event.phoneIdentity,phoneE164:history[1].event.phoneE164}),/NUMBER_IDENTITY_CONFLICT/);
 }finally{await receiver.close();}
});
test('lost ACK, duplicate ringing, restart and a new call within a second preserve identities without replay',async()=>{
 const delivered=[];const cfg=await config({deliver:async e=>delivered.push(e)});let receiver=await createLocalReceiver(cfg);
 const p=parsePhone('+966501234567');const call=event(p.display,{phoneIdentity:p.identity,phoneE164:p.e164});
 for(let i=0;i<5;i++)await receiver.accept(call);await receiver.idle();assert.equal(delivered.length,1);await receiver.close();
 receiver=await createLocalReceiver(cfg);
 try {await receiver.accept(call);await receiver.idle();assert.equal(delivered.length,1);
  await receiver.accept({...call,eventId:randomUUID(),timestamp:call.timestamp+100});await receiver.idle();assert.equal(delivered.length,2);assert.equal(receiver.history().length,2);
  const disk=await readFile(join(cfg.directory,'events.enc'),'utf8');assert.ok(!disk.includes('501234567'));
 }finally{await receiver.close();}
});
test('long and unverified numbers are durably acknowledged with an explicit GRID failure',async()=>{
 let delivered=0;const cfg=await config({deliver:async()=>delivered++});const receiver=await createLocalReceiver(cfg);
 try {for(const n of ['1234567890123456','+999123456789'])assert.ok((await receiver.accept(event(n))).receiverAcknowledged);
  await receiver.idle();assert.equal(delivered,0);assert.deepEqual(new Set(receiver.history().map(r=>r.error)),new Set(['GRID_PHONE_TOO_LONG','GRID_PHONE_UNVERIFIED']));
  assert.ok(receiver.history().every(r=>r.grid==='GRID_BLOCKED'));assert.equal(JSON.parse(await readFile(join(cfg.directory,'status.json'),'utf8')).blockedGrid,2);
 }finally{await receiver.close();}
});
test('unresolved contact event can enrich once without timestamp changes or identity guessing',async()=>{
 let delivered=0;const receiver=await createLocalReceiver(await config({deliver:async()=>delivered++}));
 const call=event('',{displayName:'أحمد علي',failureReason:'CONTACT_AMBIGUOUS'});
 try {await receiver.accept(call);await receiver.idle();assert.equal(delivered,0);
  const p=parsePhone('+819012345678');const resolved={...call,revision:2,number:p.display,phoneIdentity:p.identity,phoneE164:p.e164,resolutionSource:'PHONE_FROM_CONTACTS'};
  await receiver.accept(resolved);await receiver.accept(resolved);await receiver.idle();assert.equal(delivered,1);assert.equal(receiver.history().length,1);assert.equal(receiver.history()[0].event.timestamp,call.timestamp);
  await assert.rejects(receiver.accept({...resolved,number:'09011111111'}),/PHONE_DISPLAY_CONFLICT/);
 }finally{await receiver.close();}
});
test('existing TCP JSON newline and matching ACK carry the complete national number plus canonical identity',async()=>{
 const received=[];const receiver=await createLocalReceiver(await config({deliver:async e=>received.push(e)}));
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const deviceId=randomUUID();
 const bridge=createOfficeCallsTcpReceiver({...identity,whatsappTcpPort:port},{directory:await mkdtemp(join(tmpdir(),'officecalls-global-tcp-')),host:'127.0.0.1',mirror:null,acceptEvent:async parsed=>receiver.accept(event(parsed.phone,{deviceId,eventId:parsed.eventId,timestamp:Date.parse(parsed.timestamp),phoneIdentity:parsed.phoneIdentity,phoneE164:parsed.phoneE164}))});
 await bridge.listen();const p=parsePhone('+966501234567');const raw={type:'incoming_call',eventId:randomUUID(),number:p.display,phoneIdentity:p.identity,phoneE164:p.e164,timestamp:Date.now()};
 const send=()=>new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port});let ack='';socket.setTimeout(3000,()=>{socket.destroy();reject(Error('ACK_TIMEOUT'));});socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify(raw)+'\n'));socket.on('data',data=>ack+=data.toString());socket.on('end',()=>resolve(ack));});
 try {assert.equal(await send(),`OK ${raw.eventId}\n`);assert.equal(await send(),`OK ${raw.eventId}\n`);await receiver.idle();assert.equal(received.length,1);assert.equal(received[0].number,'0501234567');assert.equal(received[0].phoneE164,p.e164);}
 finally{await bridge.close();await receiver.close();}
});
test('loopback UDP reaches the GRID fixture exactly once with safe local digits',async()=>{
 const udp=createSocket('udp4');await new Promise(resolve=>udp.bind(0,'127.0.0.1',resolve));
 try {const packet=new Promise(resolve=>udp.once('message',resolve));await sendOfficeMirror({eventId:randomUUID(),phone:'+966501234567'},{host:'127.0.0.1',port:udp.address().port});
  assert.equal(parseOfficeOutput(await packet),'0501234567');
 }finally{udp.close();}
});
test('real loopback TLS verifies certificate, authorization, identity, ACK and GRID datagram',async()=>{
 const cfg=await config();const pfxPath=join(cfg.directory,'fixture.p12');const pemPath=join(cfg.directory,'fixture.pem');
 const keytool='C:/Program Files/Android/Android Studio/jbr/bin/keytool.exe';
 execFileSync(keytool,['-genkeypair','-alias','fixture','-keyalg','RSA','-keysize','2048','-sigalg','SHA256withRSA','-validity','2','-dname','CN=OfficeCalls Loopback Fixture','-ext','SAN=ip:127.0.0.1','-storetype','PKCS12','-keystore',pfxPath,'-storepass','fixture-only-password','-noprompt'],{stdio:'pipe'});
 execFileSync(keytool,['-exportcert','-rfc','-alias','fixture','-keystore',pfxPath,'-storepass','fixture-only-password','-file',pemPath],{stdio:'pipe'});
 const pem=await readFile(pemPath,'utf8');const pin=new X509Certificate(pem).fingerprint256;
 const udp=createSocket('udp4');await new Promise(resolve=>udp.bind(0,'127.0.0.1',resolve));const packets=[];udp.on('message',p=>packets.push(p));
 const receiver=await createLocalReceiver({...cfg,deliver:e=>sendOfficeMirror({phone:e.number,eventId:e.eventId},{host:'127.0.0.1',port:udp.address().port})});
 const server=receiver.listen({host:'127.0.0.1',port:0,tls:{pfx:await readFile(pfxPath),passphrase:'fixture-only-password',minVersion:'TLSv1.2'}});
 await new Promise(resolve=>server.once('listening',resolve));
 const query=(path,body,token=cfg.token,expectedPin=pin)=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:server.address().port,path,method:body?'POST':'GET',ca:pem,checkServerIdentity:(_h,cert)=>cert.fingerprint256===expectedPin?undefined:Error('PIN_MISMATCH'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text?JSON.parse(text):null}));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TLS_TIMEOUT')));req.end(body?JSON.stringify(body):undefined);
 });
 try {assert.equal((await query('/health')).body.version,'3.2.5');assert.equal((await query('/health',null,'wrong')).status,403);await assert.rejects(query('/health',null,cfg.token,'wrong'),/PIN_MISMATCH/);
  const p=parsePhone('+966501234567');const call=event(p.display,{phoneIdentity:p.identity,phoneE164:p.e164});
  for(let i=0;i<3;i++)assert.ok((await query('/events',call)).body.receiverAcknowledged);
  await receiver.idle();await new Promise(resolve=>setTimeout(resolve,100));assert.equal(packets.length,1);assert.equal(parseOfficeOutput(packets[0]),'0501234567');
  const history=(await query('/history')).body.events;assert.equal(history.length,1);assert.equal(history[0].event.phoneE164,p.e164);assert.equal(history[0].grid,'UDP_SENT');
 }finally{await new Promise(resolve=>server.close(resolve));await receiver.close();udp.close();}
});
test('packaged Windows receiver uses the updated metadata and preserves legacy journal retries',async()=>{
 const packaged=await import('../artifacts/officecalls-global-20261013/OfficeCalls-Windows-Receiver-3.2.5/scripts/officecalls-agent/local-receiver.mjs');
 assert.equal(packaged.VERSION,'3.2.5');let sent=0;const cfg=await config({deliver:async()=>sent++});
 let receiver=await packaged.createLocalReceiver(cfg);const call=event('0591234567');
 try {await receiver.accept(call);await receiver.idle();assert.equal(sent,1);}finally{await receiver.close();}
 receiver=await packaged.createLocalReceiver(cfg);
 try {await receiver.accept(call);await receiver.accept(event('+966501234567'));await receiver.idle();assert.equal(sent,2);assert.equal(receiver.history().length,2);assert.equal(receiver.history()[1].event.number,'0501234567');assert.equal(receiver.history()[1].event.phoneE164,'+966501234567');}
 finally{await receiver.close();}
});
