import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { parseCaller, createCallerProcessor } from '../app/scripts/lib/icall-caller.mjs';
import { sendCall } from '../app/scripts/send-call.mjs';
const ip = '192.168.0.90';
// Synthetic envelopes around the two phone pairs reported by the user, NOT full captured fixtures.
const packet = (a = '056-898-4084', b = '0568984084') => Buffer.from(`^^<U>\0 09/25/2026 09:23:15 0001 ${a.padEnd(15)}${b.padEnd(15)}\0\r\n`);
async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'caller-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('caller parser requires two matching expected phone fields at the payload tail', () => {
  assert.deepEqual(parseCaller(packet()), { phone: '0568984084' });
  assert.deepEqual(parseCaller(packet('092315136', '092315136')), { phone: '092315136' });
  assert.deepEqual(parseCaller(packet('056 898 4084', '0568984084')), { phone: '0568984084' });
  assert.equal(parseCaller(packet('0568984084', '092315136')), null);
  assert.equal(parseCaller(packet('09/25/2026', '09:23:15')), null);
  assert.equal(parseCaller(Buffer.from('0568984084')), null);
  assert.equal(parseCaller(Buffer.from('0568984084 0568984084 other trailing fields')), null);
  assert.equal(parseCaller(packet('05689840840', '05689840840')), null);
  assert.equal(parseCaller(packet('059999999', '059999999')), null);
  assert.equal(parseCaller(packet('20260925', '20260925')), null);
  assert.equal(parseCaller(Buffer.alloc(0)), null);
});
test('one caller display across duplicate packets, capture paths and restart; quiet gap permits next call', async t => {
  const dir = await temp(t); let now = 100000;
  const shown = [], sent = [];
  const options = { directory: dir, clock: () => now, onCall: item => shown.push(item), send: async event => sent.push(event) };
  let p = await createCallerProcessor(options);
  assert.equal(await p.receive(packet(), '127.0.0.1'), null);
  await Promise.all(Array.from({ length: 10 }, () => p.receive(packet(), ip)));
  assert.equal(shown.length, 1);
  await p.retry(); assert.equal(sent.length, 1);
  for (let i = 0; i < 10; i++) { now += 10000; await p.receive(packet(), ip); }
  p = await createCallerProcessor(options);
  await p.receive(packet(), ip); await p.retry();
  assert.equal(shown.length, 1); assert.equal(sent.length, 1);
  now += 30001; await p.receive(packet(), ip); await p.retry();
  assert.equal(shown.length, 2); assert.equal(sent.length, 2);
  assert.notEqual(sent[0].eventId, sent[1].eventId);
  await p.receive(packet('092315136', '092315136'), ip);
  assert.equal(shown.length, 3);
});
test('display is immediate while HTTP is offline; retry/restart preserve identical event identity', async t => {
  const dir = await temp(t); const shown = [], attempted = [];
  const first = await createCallerProcessor({ directory: dir, onCall: value => shown.push(value), send: async event => { attempted.push(event); throw Error('offline'); } });
  await first.receive(packet(), ip);
  assert.equal(shown.length, 1);
  await assert.rejects(first.retry(), /offline/);
  const restarted = await createCallerProcessor({ directory: dir, send: async event => attempted.push(event) });
  await restarted.retry();
  assert.deepEqual(attempted[0], attempted[1]);
  await restarted.retry(); assert.equal(attempted.length, 2);
});
test('failed persistence cannot display or send an unrecorded event', async t => {
  const dir = await temp(t); let shown = 0, sent = 0;
  const p = await createCallerProcessor({ directory: dir, onCall: () => shown++, send: async () => sent++ });
  await mkdir(join(dir, 'caller-state.json'));
  await assert.rejects(p.receive(packet(), ip)); await p.retry();
  assert.equal(shown, 0); assert.equal(sent, 0);
  await rm(join(dir, 'caller-state.json'), { recursive: true });
  await p.receive(packet(), ip); await p.retry();
  assert.equal(shown, 1); assert.equal(sent, 1);
});
test('parsed caller forwards through unchanged sendCall into the existing Call Integration route and store', async t => {
  const dir = await temp(t);
  const previous = { directory: process.env.DISPATCHPRO_LOCAL_DATA_DIR, enabled: process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED, token: process.env.DISPATCHPRO_CALL_TOKEN };
  process.env.DISPATCHPRO_LOCAL_DATA_DIR = dir; process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED = 'true'; delete process.env.DISPATCHPRO_CALL_TOKEN;
  t.after(() => { for (const [key, value] of Object.entries({ DISPATCHPRO_LOCAL_DATA_DIR: previous.directory, DISPATCHPRO_LOCAL_CALLS_ENABLED: previous.enabled, DISPATCHPRO_CALL_TOKEN: previous.token })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const route = await import('../app/route.mjs');
  const server = createServer(async (req, res) => {
    const request = new Request(`http://127.0.0.1:${server.address().port}/api/calls`, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: req, duplex: 'half' } : {}) });
    const response = await route[req.method](request); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const p = await createCallerProcessor({ directory: join(dir, 'parser'), send: event => sendCall(event, url) });
  await p.receive(packet(), ip); await p.retry(); await p.receive(packet(), ip); await p.retry();
  const response = await fetch(url, { headers: { 'sec-fetch-site': 'same-origin', 'x-dispatchpro-client': 'reception' } });
  const data = await response.json();
  assert.equal(data.events.length, 1); assert.equal(data.events[0].event.phone, '0568984084'); assert.equal(data.events[0].event.source, 'LANDLINE_ICALL');
});
