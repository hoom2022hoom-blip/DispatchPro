import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createLocalReceiver,isLocalAddress} from '../scripts/officecalls-agent/local-receiver.mjs';
import {officeMirrorPayload} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';

const token='a'.repeat(64),device=randomUUID();
const event=(extra={})=>({eventId:randomUUID(),deviceId:device,revision:1,number:'0591234567',displayName:'',package:'com.whatsapp',timestamp:Date.now(),...extra});
async function fixture(extra={}) {const config={directory:await mkdtemp(join(tmpdir(),'officecalls-310-')),key:randomBytes(32),token,...extra};return {config,receiver:await createLocalReceiver(config)};}
test('20 consecutive calls from same number, concurrent devices and both apps deliver exactly once',async()=>{
 const delivered=[];const {receiver}=await fixture({deliver:async e=>delivered.push(e)});
 const calls=Array.from({length:20},(_,i)=>event({package:i%2?'com.whatsapp.w4b':'com.whatsapp',deviceId:i%3?device:randomUUID()}));
 const acks=await Promise.all(calls.map(e=>receiver.accept(e)));
 assert.equal(acks.filter(a=>a.receiverAcknowledged).length,20);await receiver.idle();
 await Promise.all(calls.map(e=>receiver.accept(e)));await receiver.idle();
 assert.equal(receiver.history().length,20);assert.equal(delivered.length,20);assert.equal(new Set(delivered.map(e=>e.eventId)).size,20);
 await receiver.close();
});
test('unresolved Arabic name survives restart and a later revision updates the same event',async()=>{
 const delivered=[];const {config,receiver}=await fixture({deliver:async e=>delivered.push(e)});
 const call=event({number:'',displayName:'رمزي دياب',failureReason:'AMBIGUOUS_CONTACT'});
 const ack=await receiver.accept(call);assert.equal(ack.gridCms,'NUMBER_UNAVAILABLE');await receiver.idle();await receiver.close();
 const restarted=await createLocalReceiver(config);assert.equal(restarted.history()[0].event.displayName,'رمزي دياب');
 await restarted.accept({...call,number:'0561234567',revision:2,failureReason:'',resolutionSource:'PHONE_FROM_PERSON'});await restarted.idle();
 await restarted.accept(call);await restarted.idle();assert.equal(restarted.history().length,1);assert.equal(delivered.length,1);
 assert.equal(restarted.history()[0].event.number,'0561234567');await restarted.close();
});
test('journal is encrypted, recovery trims an uncommitted tail, acknowledged duplicate never replays UDP',async()=>{
 const delivered=[];const {config,receiver}=await fixture({deliver:async e=>delivered.push(e)});const call=event();
 await receiver.accept(call);await receiver.idle();await receiver.close();
 const journal=join(config.directory,'events.enc');const text=await readFile(journal,'utf8');assert.ok(!text.includes(call.number));
 await appendFile(journal,'partial-write');const restarted=await createLocalReceiver(config);
 await restarted.accept(call);await restarted.idle();assert.equal(delivered.length,1);assert.equal(restarted.history()[0].grid,'UDP_SENT');await restarted.close();
 await assert.rejects(()=>createLocalReceiver({...config,key:randomBytes(32)}));
});
test('uncertain UDP is visible and never retried after crash or event replay',async()=>{
 let attempts=0;const {config,receiver}=await fixture({deliver:async()=>{attempts++;throw Error('uncertain');}});const call=event();
 await receiver.accept(call);await receiver.idle();assert.equal(receiver.history()[0].grid,'UDP_UNCERTAIN');await receiver.close();
 const restarted=await createLocalReceiver(config);await restarted.accept(call);await restarted.idle();assert.equal(attempts,1);await restarted.close();
});
test('late events are preserved in history and never displayed as fresh calls',async()=>{
 let sent=0;const {receiver}=await fixture({deliver:async()=>sent++});const call=event({timestamp:Date.now()-86400000});
 assert.ok((await receiver.accept(call)).receiverAcknowledged);await receiver.idle();assert.equal(sent,0);assert.equal(receiver.history()[0].grid,'HISTORY_ONLY');await receiver.close();
});
test('event identifiers are scoped per phone and conflicting number or revision cannot replace identity',async()=>{
 const {receiver}=await fixture({deliver:async()=>{}});const call=event();await receiver.accept(call);await receiver.idle();
 await receiver.accept({...call,deviceId:randomUUID()});await receiver.idle();assert.equal(receiver.history().length,2);
 await assert.rejects(()=>receiver.accept({...call,number:'0561234567',revision:2}),/CONFLICT/);
 await assert.rejects(()=>receiver.accept({...call,displayName:'other'}),/CONFLICT/);
 await receiver.close();
});
test('retention redacts personal data but preserves deduplication tombstone',async()=>{
 let now=Date.now(),sent=0;const {receiver}=await fixture({clock:()=>now,retentionDays:1,deliver:async()=>sent++});const call=event({timestamp:now});
 await receiver.accept(call);await receiver.idle();now+=2*86400000;await receiver.prune();assert.equal(receiver.history()[0].event.number,'');
 assert.ok(receiver.history()[0].redacted);await receiver.accept(call);await receiver.idle();assert.equal(sent,1);await receiver.close();
});
test('GRIDCMS frame retains exact 83-byte legacy format, line 04 and country-derived national digits',()=>{
 const stamp=new Date(2026,9,11,14,35);const packet=officeMirrorPayload('+442079460018',stamp);
 assert.equal(packet.length,83);assert.equal(packet.subarray(21,23).toString(),'04');assert.ok(packet.toString().includes('02079460018'));
 assert.deepEqual([...packet.subarray(0,5)],[94,94,60,85,62]);
 for(const ip of ['192.168.1.2','10.1.2.3','172.16.5.1','127.0.0.1','::ffff:192.168.1.2'])assert.ok(isLocalAddress(ip));
 for(const ip of ['8.8.8.8','172.32.1.1','2001:db8::1'])assert.ok(!isLocalAddress(ip));
});
