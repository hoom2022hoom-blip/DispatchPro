import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createIcallProcessor, parseIcallPacket, listenIcall } from '../scripts/lib/icall-udp.mjs';
import { sendCall } from '../scripts/send-call.mjs';

const ip = '192.168.0.90';
const packet = ({ line = '01', phase = 'S', direction = 'I', stamp = '09/25 10:00 AM', phone = '092345678', name = 'Caller' } = {}) =>
  Buffer.from(`${line} ${direction} ${phase} 0000 G 01 ${stamp} ${phone.padEnd(15)}${name.padEnd(15)}`);
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dispatchpro-icall-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('iCall parser accepts raw/framed records and rejects outgoing, malformed and caller-name fallback', () => {
  const raw = packet();
  assert.equal(raw.length, 62);
  assert.equal(parseIcallPacket(raw).phone, '092345678');
  assert.deepEqual(parseIcallPacket(Buffer.concat([Buffer.from('^^<U>'.padEnd(21)), raw])), parseIcallPacket(raw));
  assert.equal(parseIcallPacket(packet({ direction: 'O' })), null);
  assert.equal(parseIcallPacket(packet({ phone: '', name: '0591234567' })), null);
  assert.equal(parseIcallPacket(Buffer.alloc(83)), null);
  assert.equal(parseIcallPacket(Buffer.from('invalid')), null);
  assert.equal(parseIcallPacket(packet({ phone: '+970 59-1234567' })).phone, '+970591234567');
});

test('iCall serializes duplicates, separates lines and calls, and ignores stale end packets', async t => {
  const sent = [];
  const processor = await createIcallProcessor({ directory: await directory(t), send: async event => sent.push(event) });
  assert.equal(await processor.receive(packet(), '192.168.0.91'), false);
  await Promise.all(Array.from({ length: 8 }, () => processor.receive(packet(), ip)));
  assert.equal(sent.length, 1);
  await processor.receive(packet({ line: '02' }), ip);
  await processor.receive(packet({ stamp: '09/25 10:01 AM' }), ip);
  await processor.receive(packet({ phase: 'E' }), ip);
  await processor.receive(packet({ stamp: '09/25 10:01 AM' }), ip);
  assert.equal(sent.length, 3);
  await processor.receive(packet({ phase: 'E', stamp: '09/25 10:01 AM' }), ip);
  await processor.receive(packet({ stamp: '09/25 10:01 AM' }), ip);
  assert.equal(sent.length, 4);
  assert.equal(new Set(sent.map(event => event.eventId)).size, 4);
  assert.ok(sent.every(event => event.source === 'LANDLINE_ICALL'));
});

test('iCall restart retries identical persisted payload after lost acknowledgment', async t => {
  const dir = await directory(t);
  let attempted;
  const first = await createIcallProcessor({ directory: dir, send: async event => { attempted = event; throw new Error('offline'); } });
  await assert.rejects(first.receive(packet(), ip), /offline/);
  const sent = [];
  const restarted = await createIcallProcessor({ directory: dir, send: async event => sent.push(event) });
  await restarted.retry();
  await restarted.receive(packet(), ip);
  assert.deepEqual(sent, [attempted]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).pending, {});
});

test('iCall never sends an event whose state failed to persist', async t => {
  const dir = await directory(t);
  const sent = [];
  const processor = await createIcallProcessor({ directory: dir, send: async event => sent.push(event) });
  await mkdir(join(dir, 'state.json'));
  await assert.rejects(processor.receive(packet(), ip));
  await processor.retry();
  assert.equal(sent.length, 0);
  await rm(join(dir, 'state.json'), { recursive: true });
  await processor.receive(packet(), ip);
  assert.equal(sent.length, 1);
});

test('UDP 3520 forwards through the existing authenticated Call Integration sender', { timeout: 10000 }, async t => {
  const dir = await directory(t);
  const previous = process.env.DISPATCHPRO_CALL_TOKEN;
  process.env.DISPATCHPRO_CALL_TOKEN = 'icall-test-token-01234567890123456789';
  t.after(() => { if (previous === undefined) delete process.env.DISPATCHPRO_CALL_TOKEN; else process.env.DISPATCHPRO_CALL_TOKEN = previous; });
  let finish;
  const received = new Promise(resolve => { finish = resolve; });
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    finish({ method: req.method, url: req.url, auth: req.headers.authorization, event: JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ duplicate: false }));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const processor = await createIcallProcessor({ directory: dir, sourceIp: '127.0.0.1', send: event => sendCall(event, `http://127.0.0.1:${server.address().port}/api/calls`) });
  const errors = [];
  const socket = listenIcall(processor, { host: '127.0.0.1', onError: error => errors.push(error) });
  t.after(() => { try { socket.close(); } catch {} });
  await once(socket, 'listening');
  const client = createSocket('udp4');
  t.after(() => client.close());
  client.send(packet(), 3520, '127.0.0.1');
  const actual = await received;
  await processor.retry();
  assert.equal(actual.method, 'POST');
  assert.equal(actual.url, '/api/calls');
  assert.equal(actual.auth, `Bearer ${process.env.DISPATCHPRO_CALL_TOKEN}`);
  assert.equal(actual.event.source, 'LANDLINE_ICALL');
  assert.equal(actual.event.phone, '092345678');
  assert.equal(actual.event.line, '01');
  assert.deepEqual(errors, []);
});
