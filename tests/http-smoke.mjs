import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { sendCall } from '../scripts/send-call.mjs';
import 'fake-indexeddb/auto';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/src/lib/') && specifier.startsWith('./') && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { localCustomers, localRides } = await import('../src/lib/local-reception.ts');
const { localReceptionBackend } = await import('../src/lib/reception-backend.ts');
const { callRideId } = await import('../src/lib/call-reception.ts');

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const directory = await mkdtemp(join(tmpdir(), 'dispatchpro-http-smoke-'));
const url = `http://127.0.0.1:${port}/api/calls`;
const token = randomBytes(32).toString('hex');
process.env.DISPATCHPRO_CALL_TOKEN = token;
let child;
async function start() {
  child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    windowsHide: true, stdio: 'ignore', env: { ...process.env, DISPATCHPRO_LOCAL_CALLS_ENABLED: 'true', DISPATCHPRO_LOCAL_DATA_DIR: directory },
  });
  let failure;
  child.on('error', error => { failure = error; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error('Test server exited before readiness');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).status === 401) return; } catch {}
    await delay(250);
  }
  throw new Error('Test server did not become ready');
}
async function stop() {
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
}
try {
  await start();
  assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  const event = { eventId: 'smoke-1', source: 'WHATSAPP', phone: '0000', timestamp: new Date().toISOString(), line: 'test' };
  assert.equal((await sendCall(event, url)).duplicate, false);
  assert.equal((await sendCall(event, url)).duplicate, true);
  const response = await fetch(url, { headers: { 'X-DispatchPro-Client': 'reception', 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).latest.event.eventId, event.eventId);
  assert.equal((await fetch(url, { headers: { Origin: 'https://external.example', Authorization: `Bearer ${token}` } })).status, 403);
  await stop();
  await start();
  assert.equal((await sendCall(event, url)).duplicate, true);
  assert.equal((await sendCall({ ...event, eventId: 'smoke-2', source: 'LANDLINE_ICALL' }, url)).duplicate, false);
  for (const source of ['MANUAL', 'CUSTOMER_APP']) {
    const next = { ...event, eventId: `smoke-${source}`, source };
    assert.equal((await sendCall(next, url)).duplicate, false);
    assert.equal((await sendCall(next, url)).duplicate, true);
  }
  const conflict = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, phone: '1111' }),
  });
  assert.equal(conflict.status, 409);
  await localCustomers.put({ id: 'smoke-customer', name: 'زبون اختبار', phoneNumber: '0000', defaultAddress: 'نابلس - رفيديا' });
  await sendCall({ ...event, eventId: 'smoke-unknown', phone: '091111111' }, url);
  const feed = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(feed.events.length, 5); // All events, not only the latest call, survive restart/bursts.
  for (const record of feed.events) await localReceptionBackend.receiveCall(record.event);
  const orders = await localRides.toArray();
  assert.equal(orders.length, 3);
  assert.deepEqual(orders.map(ride => ride.orderNumber).sort((a, b) => a - b), [1, 2, 3]);
  const known = await localRides.get(await callRideId(event.eventId));
  assert.equal(known.passengerName, 'زبون اختبار');
  assert.equal(known.pickup.name, 'نابلس - رفيديا');
  assert.ok(orders.every(ride => ride.receptionPending && ride.driverId === null));
  const unknown = await localRides.get(await callRideId('smoke-unknown'));
  assert.equal(unknown.passengerPhone, '091111111');
  assert.equal(unknown.pickup.name, '');
  await localReceptionBackend.saveRide({ ...known, passengerName: 'تعديل محفوظ', receptionPending: false });
  for (const record of feed.events) await localReceptionBackend.receiveCall(record.event);
  assert.equal(await localRides.count(), 3);
  assert.equal((await localRides.get(known.id)).passengerName, 'تعديل محفوظ');
  console.log('PASS: HTTP auth, four sources, eventId conflicts/restart, burst replay to real reception backend, customer lookup, unknown caller, daily numbering, no automatic dispatch, and preserved edits.');
} finally {
  localRides.db.close();
  await stop();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir(), 'dispatchpro-http-smoke-')));
  await rm(directory, { recursive: true, force: true });
}
