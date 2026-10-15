import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {formatCallTime,CALL_TIME_ZONE} from '../scripts/officecalls-agent/call-time.mjs';
import {createLocalReceiver} from '../scripts/officecalls-agent/local-receiver.mjs';

test('Asia/Hebron civil time, including spring and autumn boundaries, ignores process timezone',()=>{
 assert.equal(CALL_TIME_ZONE,'Asia/Hebron');
 for(const [utc,local] of [
  ['2026-01-15T10:00:00Z','2026-01-15 12:00:00'],['2026-07-15T10:00:00Z','2026-07-15 13:00:00'],
  ['2026-03-27T23:59:59Z','2026-03-28 01:59:59'],['2026-03-28T00:00:00Z','2026-03-28 03:00:00'],
  ['2026-10-23T22:59:59Z','2026-10-24 01:59:59'],['2026-10-23T23:00:00Z','2026-10-24 01:00:00']
 ])assert.equal(formatCallTime(Date.parse(utc)),local);
 assert.equal(formatCallTime(0),'—');
});
test('nine offline calls, including name-only, survive ACK loss, restart and enrichment with original time',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls-repair-324-'));const key=randomBytes(32),token='a'.repeat(64);
 const start=Date.parse('2026-07-15T10:00:00Z'),deviceId=randomUUID(),delivered=[];
 let now=start+10000;
 const config={directory,key,token,clock:()=>now,deliver:async e=>delivered.push(e)};
 let receiver=await createLocalReceiver(config);
 const calls=Array.from({length:9},(_,i)=>({eventId:randomUUID(),deviceId,revision:1,package:'com.whatsapp.w4b',timestamp:start+i*1000,number:i?'0561234567':'',displayName:i?'':'حكمت قليل',failureReason:i?'':'CONTACT_NOT_FOUND'}));
 for(const call of calls){assert.ok((await receiver.accept(call)).receiverAcknowledged);await receiver.accept(call);}
 await receiver.idle();assert.equal(receiver.history().length,9);assert.equal(delivered.length,8);await receiver.close();
 now+=600000;receiver=await createLocalReceiver(config);
 for(const call of calls)await receiver.accept(call);
 const enriched={...calls[0],revision:2,number:'0568602288',resolutionSource:'PHONE_FROM_CONTACTS',failureReason:''};
 await receiver.accept(enriched);await receiver.accept(enriched);await receiver.idle();
 assert.equal(receiver.history().length,9);assert.equal(delivered.length,8);
 const record=receiver.history().find(r=>r.event.eventId===calls[0].eventId);
 assert.equal(record.event.timestamp,start);assert.equal(record.receivedAt,start+10000);assert.equal(record.grid,'HISTORY_ONLY');
 await assert.rejects(receiver.accept({...enriched,revision:3,timestamp:now}),/EVENT_ID_CONFLICT/);
 await receiver.close();
});
test('successful extraction has no failure reason and legacy metadata survives same-revision lost ACK retry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'officecalls-repair-legacy-'));const key=randomBytes(32),token='a'.repeat(64);
 const config={directory,key,token,gridEnabled:false};let receiver=await createLocalReceiver(config);
 const event={eventId:randomUUID(),deviceId:randomUUID(),revision:2,package:'com.whatsapp.w4b',timestamp:Date.now(),number:'0568602288',displayName:'',failureReason:''};
 await receiver.accept(event);await receiver.idle();assert.equal(receiver.history()[0].event.failureReason,'');await receiver.close();
 const journal=join(directory,'events.enc');const lines=(await readFile(journal,'utf8')).trim().split('\n');
 const legacy=lines.map(line=>{const b=Buffer.from(line,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));
  const record=JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]));record.event.failureReason='PHONE_NOT_EXPOSED';
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(JSON.stringify(record)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');});
 await writeFile(journal,legacy.join('\n')+'\n');receiver=await createLocalReceiver(config);
 assert.ok((await receiver.accept(event)).receiverAcknowledged);await receiver.idle();assert.equal(receiver.history().length,1);await receiver.close();
});
