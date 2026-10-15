import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReceptionWorker, digest } from '../scripts/lib/reception-worker.mjs';
import { createCallStore } from '../src/lib/call-store.ts';
import { proxyReception } from '../src/lib/reception-proxy.ts';
import { createApiReceptionBackend, decodeReceptionSnapshot } from '../src/lib/reception-api.ts';

test('worker retries failed and response-lost events, survives restart and keeps tenant checkpoints separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reception-worker-'));
  try {
    const event = { eventId: 'worker-1', source: 'WHATSAPP', phone: '0591234567', timestamp: '2026-09-27T12:00:00.000Z' };
    await createCallStore(join(directory, 'calls')).append(event);
    let office = 'tenant-a', fail = true, sends = 0;
    const fetchImpl = async (url, init) => {
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'test-token', expiresIn: 1800 });
      if (url.endsWith('/me')) return Response.json({ tenantId: office });
      sends++; assert.equal(init.headers.Authorization, 'Bearer test-token');
      if (fail) { fail = false; throw new Error('Connection lost after commit'); }
      return Response.json({ duplicate: true, eventId: JSON.parse(init.body).eventId });
    };
    const options = { directory, apiUrl: 'http://127.0.0.1:9010', tenant: 'office', username: 'worker', password: 'not-real', fetchImpl };
    assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 0, failed: 1 });
    assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 1, failed: 0 });
    assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 0, failed: 0 });
    assert.equal(sends, 2);
    office = 'tenant-b';
    assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 1, failed: 0 });
    await writeFile(join(directory, 'calls', `${digest('poison')}.json`), '{bad');
    await createCallStore(join(directory, 'calls')).append({ ...event, eventId: 'worker-2' });
    assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 1, failed: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('worker never acknowledges conflict or authentication failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reception-retry-'));
  try {
    await createCallStore(join(directory, 'calls')).append({ eventId: 'conflict', source: 'LANDLINE_ICALL', phone: '0000', timestamp: '2026-09-27T12:00:00Z' });
    let logins = 0, status = 401;
    const worker = createReceptionWorker({ directory, apiUrl: 'http://localhost:9010', tenant: 'office', username: 'worker', password: 'test', fetchImpl: async url => {
      if (url.endsWith('/auth/login')) { logins++; return Response.json({ accessToken: 'test', expiresIn: 1800 }); }
      if (url.endsWith('/me')) return Response.json({ tenantId: 'office' });
      return new Response(null, { status });
    } });
    assert.equal((await worker.runOnce()).failed, 1);
    status = 409; assert.equal((await worker.runOnce()).failed, 1); assert.equal(logins, 2);
    assert.equal((await worker.runOnce()).failed, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('reception proxy enforces employee token, origin, route and body limits', async () => {
  const req = (path, init) => new Request(`http://localhost:9005/api/reception/${path}`, init);
  let invoked = 0;
  const upstream = async (url, init) => { invoked++; assert.equal(url, 'http://127.0.0.1:9010/api/v1/reception/snapshot'); assert.equal(init.headers.Authorization, 'Bearer employee'); return new Response(null, { status: 304, headers: { etag: '"version"' } }); };
  assert.equal((await proxyReception(req('reception/snapshot'), ['reception', 'snapshot'], 'http://127.0.0.1:9010', upstream)).status, 401);
  assert.equal((await proxyReception(req('reception/snapshot', { headers: { Authorization: 'Bearer employee', Origin: 'https://evil.example' } }), ['reception', 'snapshot'], 'http://127.0.0.1:9010', upstream)).status, 403);
  assert.equal((await proxyReception(req('users'), ['users'], 'http://127.0.0.1:9010', upstream)).status, 404);
  assert.equal((await proxyReception(req('auth/login', { method: 'POST', body: 'x'.repeat(131073) }), ['auth', 'login'], 'http://127.0.0.1:9010', upstream)).status, 413);
  const response = await proxyReception(req('reception/snapshot', { headers: { Authorization: 'Bearer employee' } }), ['reception', 'snapshot'], 'http://127.0.0.1:9010', upstream);
  assert.equal(response.status, 304); assert.equal(response.headers.get('etag'), '"version"'); assert.equal(invoked, 1);
});

test('reception proxy uses HTTP Host when Next reconstructs the URL, without trusting forwarded hosts', async () => {
  const invoke = (origin, host = '127.0.0.1:9005') => proxyReception(new Request('http://localhost:9005/api/reception/auth/login', {
    method: 'POST', headers: { Host: host, Origin: origin, 'X-Forwarded-Host': 'evil.example' }, body: '{}',
  }), ['auth', 'login'], 'http://127.0.0.1:9010', async () => Response.json({ ok: true }));
  assert.equal((await invoke('http://127.0.0.1:9005')).status, 200);
  assert.equal((await invoke('http://evil.example')).status, 403);
  assert.equal((await invoke('http://127.0.0.1:9006')).status, 403);
  assert.equal((await invoke('https://127.0.0.1:9005')).status, 403);
});

test('API provider uses the existing write contract, preserves versions and restores Date fields', async () => {
  const calls = [];
  const provider = createApiReceptionBackend(async (path, init) => {
    calls.push({ path, ...init });
    return path.endsWith('/auth/login') ? Response.json({ accessToken: 'employee' }) : Response.json({});
  });
  await assert.rejects(() => provider.saveRide({ id: 'a', pickup:{name:''} }), /الدخول/);
  await provider.login('office', 'user', 'password');
  await provider.saveRide({ id: 'a', pickup:{name:''}, receptionVersion: 7 });
  assert.equal(calls[1].headers.Authorization, 'Bearer employee'); assert.equal(JSON.parse(calls[1].body).receptionVersion, 7);
  await provider.changeQueue({ type: 'move', shiftId: 'shift' }); assert.match(calls[2].path, /queue$/);
  await provider.ensureRideNumber({ id: 'a' }); assert.equal(calls.length, 3);
  provider.logout(); await assert.rejects(() => provider.receiveCall({}), /الدخول/);
  const data = decodeReceptionSnapshot({ rides: [{ createdAt: '2026-09-27T12:00:00Z' }], vehicles: [], shifts: [{ startTime: '2026-09-27T12:00:00Z' }], drivers: [], queue: [], latest: null });
  assert.ok(data.rides[0].createdAt instanceof Date); assert.ok(data.shifts[0].startTime instanceof Date);
});
