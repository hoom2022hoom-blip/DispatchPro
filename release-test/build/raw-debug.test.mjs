import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createSocket } from 'node:dgram';
import { formatPacket, listenRaw } from '../app/scripts/lib/icall-raw.mjs';
test('metadata and UTF-8 preserve raw binary and Unicode', () => {
 const packet = Buffer.concat([Buffer.from([0,255,10]), Buffer.from('رقم')]);
 const text = formatPacket(packet,{address:'192.168.0.90',port:12345},3520,'2026-09-25T12:00:00.000Z');
 for(const value of ['Source IP: 192.168.0.90','Source Port: 12345','Local Port: 3520','Timestamp: 2026-09-25T12:00:00.000Z','invalid sequences replaced','رقم']) assert.ok(text.includes(value));
 assert.match(formatPacket(Buffer.from('رقم'),{address:'127.0.0.1',port:1},3520),/UTF-8 \(valid\)/);
});
test('UDP 3520 logs all bytes of unlisted-source malformed, empty and large packets', {timeout:10000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'icall-debug-'));
 const logFile=join(dir,'icall-raw.log');
 const seen=[], errors=[];
 const socket=listenRaw({logFile,output:record=>seen.push(record),onError:error=>errors.push(error)});
 const sender=createSocket('udp4');
 try {
  await once(socket,'listening');
  for(const packet of [Buffer.from([0,255,65,10]),Buffer.alloc(0),Buffer.alloc(60000,0xab)]) {
   const arrived=once(socket,'message');
   await new Promise((resolve,reject)=>sender.send(packet,3520,'127.0.0.1',error=>error?reject(error):resolve()));
   await arrived;
   const record=seen.at(-1);
   assert.match(record,/Source IP: 127.0.0.1/);
   assert.ok(record.includes(`Source Port: ${sender.address().port}`));
   assert.ok(record.includes(`Packet length: ${packet.length} bytes`));
   assert.deepEqual(Buffer.from(record.split('\n').find(line=>line.startsWith('HEX: ')).slice(5).replaceAll(' ',''),'hex'),packet);
  }
  assert.equal(await readFile(logFile,'utf8'),seen.map(record=>record+'\n').join(''));
  assert.deepEqual(errors,[]);
 } finally {sender.close();socket.close();await rm(dir,{recursive:true,force:true});}
});
