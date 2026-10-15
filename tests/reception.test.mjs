import 'fake-indexeddb/auto';
import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Dexie from 'dexie';
import { businessDay, numberLegacyRides } from '../src/lib/ride-numbering.ts';
import { changeQueue } from '../src/lib/driver-queue.ts';
import { createCallStore } from '../src/lib/call-store.ts';
import { isLocalRequest, isReceptionReader, localCallToken, validToken } from '../src/lib/local-call-security.ts';
import { parseCallEvent } from '../src/lib/call-events.ts';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (context.parentURL?.includes('/src/lib/') && specifier.startsWith('./') && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });

const ride = (id, createdAt = new Date('2030-09-24T10:00:00Z')) => ({ id, createdAt, updatedAt: createdAt, pickup: { name: 'اختبار محلي', coords: { x: 0, y: 0 } }, totalFare: 0, movingFee: false, status: 'pending', driverId: null });

test('compact reception edits preserve identity, numbering, phone, source and fare while saving address status', async () => {
  const { applyReceptionEdit } = await import('../src/lib/reception-editor.ts');
  const original = { ...ride('edit-form'), orderNumber: 7, orderDay: '2030-09-24', passengerPhone: '0000', passengerName: 'أرضي', source: 'LANDLINE_ICALL', callEventId: 'existing-call', totalFare: 32, receptionPending: true };
  const values = { passengerName: ' زبون ', address: ' شارع القدس ', addressStatus: 'variable', notes: ' قرب المدرسة ', status: 'waiting' };
  const edited = applyReceptionEdit(original, values);
  assert.equal(edited.passengerName, 'زبون'); assert.equal(edited.pickup.name, 'شارع القدس');
  assert.equal(edited.addressStatus, 'variable'); assert.equal(edited.notes, 'قرب المدرسة'); assert.equal(edited.receptionPending, false);
  for (const key of ['id', 'orderNumber', 'orderDay', 'passengerPhone', 'source', 'callEventId', 'totalFare', 'createdAt']) assert.equal(edited[key], original[key]);
  assert.deepEqual(edited.pickup.coords, original.pickup.coords);
  assert.equal(original.passengerName, 'أرضي');
  assert.equal(applyReceptionEdit(original, { ...values, address: ' ' }).pickup.name, '');
  assert.throws(() => applyReceptionEdit(original, { ...values, status: 'assigned' }), /السائق/);
  const assigned = { ...original, status: 'assigned', driverId: 'driver', shiftId: 'shift', assignedAt: new Date() };
  const cancelled = applyReceptionEdit(assigned, { ...values, status: 'cancelled' });
  assert.equal(cancelled.driverId, null); assert.equal(cancelled.shiftId, null); assert.equal(cancelled.assignedAt, undefined);
  assert.equal(applyReceptionEdit(assigned, { ...values, status: 'completed' }).driverId, 'driver');
});

test('business day changes at Jerusalem midnight in winter and summer', () => {
  assert.equal(businessDay('2026-09-24T20:59:59Z'), '2026-09-24');
  assert.equal(businessDay('2026-09-24T21:00:00Z'), '2026-09-25');
  assert.equal(businessDay('2026-01-24T21:59:59Z'), '2026-01-24');
  assert.equal(businessDay('2026-01-24T22:00:00Z'), '2026-01-25');
});

test('legacy numbering preserves assigned numbers and is independent of input ordering', () => {
  const old = { ...ride('a'), orderDay: '2030-09-24', orderNumber: 5 };
  const result = numberLegacyRides([ride('c'), old, ride('b')]);
  assert.deepEqual(result.map(item => item.orderNumber), [5, 6, 7]);
  assert.deepEqual(numberLegacyRides([...result].reverse()), result);
});

test('queue maintains entry times, deduplicates additions, and supports moves', () => {
  const first = changeQueue([], { type: 'add', shiftId: 'a', now: '2026-09-24T10:00:00Z' });
  assert.deepEqual(changeQueue(first, { type: 'add', shiftId: 'a' }), first);
  const second = changeQueue(first, { type: 'add', shiftId: 'b' });
  const moved = changeQueue(second, { type: 'move', shiftId: 'b', beforeShiftId: 'a' });
  assert.deepEqual(moved.map(item => item.shiftId), ['b', 'a']);
  assert.equal(moved[1].joinedAt, first[0].joinedAt);
  assert.deepEqual(changeQueue(moved, { type: 'remove', shiftId: 'b' }), first);
  assert.deepEqual(changeQueue(first, { type: 'up', shiftId: 'a' }), first);
});

test('actual IndexedDB upgrade, concurrent numbering, immutable edits, daily reset and atomic queue assignment', async () => {
  const oldDatabase = new Dexie('DispatchProReceptionDemo');
  oldDatabase.version(1).stores({ rides: 'id,createdAt' });
  await oldDatabase.table('rides').add(ride('legacy', new Date('2026-01-01T10:00:00Z')));
  oldDatabase.close();
  const local = await import('../src/lib/local-reception.ts');
  const { getReceptionBackend } = await import('../src/lib/reception-backend.ts');
  const backend = getReceptionBackend(true);
  assert.notEqual(backend, getReceptionBackend(false));
  assert.equal((await local.localRides.get('legacy')).orderNumber, 1);
  const saved = await Promise.all(Array.from({ length: 20 }, (_, index) => local.saveLocalRide(ride(`parallel-${index}`))));
  assert.deepEqual(saved.map(item => item.orderNumber).sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  const edited = await local.saveLocalRide({ ...saved[0], orderNumber: 999, orderDay: '2099-01-01', createdAt: new Date('2099-01-01'), passengerName: 'تعديل', passengerPhone: '0000', addressStatus: 'variable' });
  assert.equal((await local.localRides.get(edited.id)).addressStatus, 'variable');
  assert.equal((await local.localRides.get(edited.id)).passengerPhone, '0000');
  assert.equal(edited.orderNumber, saved[0].orderNumber);
  assert.equal(edited.orderDay, saved[0].orderDay);
  assert.equal(edited.createdAt.getTime(), saved[0].createdAt.getTime());
  assert.equal((await local.saveLocalRide(ride('tomorrow', new Date('2030-09-24T21:00:00Z')))).orderNumber, 1);
  await backend.saveRide(ride('backend-contract', new Date('2030-09-24T21:00:00Z')));
  await backend.saveRide({ ...ride('backend-contract', new Date('2030-09-24T21:00:00Z')), passengerName: 'واجهة موحدة' });
  assert.equal((await local.localRides.get('backend-contract')).orderNumber, 2);
  assert.equal((await local.localRides.get('backend-contract')).passengerName, 'واجهة موحدة');
  await local.createLocalShift('سائق اختبار', 'سيارة اختبار');
  const shift = (await local.localShifts.toArray())[0];
  await assert.rejects(local.createLocalShift('سائق اختبار', 'سيارة أخرى'));
  assert.equal((await local.localQueue.get('main')).entries.length, 1);
  const assignments = await Promise.allSettled(['assign-a', 'assign-b'].map(id => local.saveLocalRide({ ...ride(id), status: 'assigned', shiftId: shift.id, driverId: shift.driverId })));
  assert.equal(assignments.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await local.localQueue.get('main')).entries.length, 0);
  await assert.rejects(local.updateLocalQueue({ type: 'add', shiftId: shift.id }));
  const assigned = assignments.find(result => result.status === 'fulfilled').value;
  await local.saveLocalRide({ ...assigned, status: 'completed' });
  await local.updateLocalQueue({ type: 'add', shiftId: shift.id });
  assert.equal((await local.localQueue.get('main')).entries.length, 1);
  local.localRides.db.close();
});

test('call journal deduplicates across concurrent writers and store restart, but not by phone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dispatchpro-calls-test-'));
  try {
    const event = parseCallEvent({ eventId: 'same', source: 'WHATSAPP', phone: '0000', timestamp: '2026-09-24T10:00:00Z' });
    const results = await Promise.all(Array.from({ length: 10 }, () => createCallStore(directory).append(event)));
    assert.equal(results.filter(result => !result.duplicate).length, 1);
    assert.equal((await createCallStore(directory).append(event)).duplicate, true);
    assert.equal((await createCallStore(directory).append({ ...event, eventId: 'later' })).duplicate, false);
    assert.ok(await createCallStore(directory).latest());
    await assert.rejects(createCallStore(directory).append({ ...event, phone: '1111' }), /EVENT_ID_CONFLICT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('automatic reception enriches customers, numbers once, preserves edits and blocks dispatch until completed', async () => {
  const local = await import('../src/lib/local-reception.ts');
  const { callRideId, normalizePhone } = await import('../src/lib/call-reception.ts');
  const { getReceptionBackend } = await import('../src/lib/reception-backend.ts');
  await local.localRides.db.open();
  const backend = getReceptionBackend(true);
  await local.localCustomers.put({ id: 'customer-1', name: 'زبون محفوظ', phoneNumber: '0599 123 456', defaultAddress: 'نابلس - رفيديا' });
  assert.equal(normalizePhone('+970599123456'), '0599123456');
  const event = { eventId: 'auto-call-1', source: 'WHATSAPP', phone: '+970599123456', timestamp: new Date().toISOString() };
  await Promise.all(Array.from({ length: 10 }, () => backend.receiveCall(event)));
  const id = await callRideId(event.eventId);
  const saved = await local.localRides.get(id);
  assert.equal(saved.passengerName, 'زبون محفوظ');
  assert.equal(saved.pickup.name, 'نابلس - رفيديا');
  assert.equal(saved.passengerPhone, event.phone);
  assert.equal(saved.source, 'WHATSAPP');
  assert.equal(saved.status, 'pending');
  assert.equal(saved.receptionPending, true);
  assert.equal(saved.driverId, null);
  assert.ok(saved.orderNumber > 0);
  const shift = (await local.localShifts.toArray())[0];
  await assert.rejects(backend.saveRide({ ...saved, status: 'assigned', driverId: shift.driverId, shiftId: shift.id }), /أكمل/);
  await backend.saveRide({ ...saved, passengerName: 'تعديل الموظف', pickup: { ...saved.pickup, name: 'عنوان جديد' }, receptionPending: false });
  await backend.receiveCall(event);
  assert.equal((await local.localRides.get(id)).passengerName, 'تعديل الموظف');
  assert.equal((await local.localRides.get(id)).receptionPending, false);
  assert.equal((await local.localRides.get(id)).orderNumber, saved.orderNumber);
  await backend.receiveCall({ ...event, eventId: 'auto-call-2' });
  assert.equal((await local.localRides.get(await callRideId('auto-call-2'))).orderNumber, saved.orderNumber + 1);
  await backend.receiveCall({ ...event, eventId: 'auto-unknown', source: 'LANDLINE_ICALL', phone: '092345678' });
  const unknown = await local.localRides.get(await callRideId('auto-unknown'));
  assert.equal(unknown.passengerName, '');
  assert.equal(unknown.pickup.name, '');
  assert.equal(unknown.source, 'LANDLINE_ICALL');
  for (const source of ['MANUAL', 'CUSTOMER_APP']) {
    await backend.receiveCall({ ...event, eventId: source, source });
    assert.equal(await local.localRides.get(await callRideId(source)), undefined);
  }
  local.localRides.db.close();
});

test('endpoint access requires loopback, rejects cross-origin, and verifies a stable secret', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dispatchpro-token-test-'));
  try {
    const tokens = await Promise.all(Array.from({ length: 5 }, () => localCallToken(directory)));
    assert.equal(new Set(tokens).size, 1);
    assert.ok(tokens[0].length >= 32);
    const request = headers => new Request('http://127.0.0.1:9005/api/calls', { headers: { host: '127.0.0.1:9005', ...headers } });
    assert.equal(validToken(request({ authorization: `Bearer ${tokens[0]}` }), tokens[0]), true);
    assert.equal(validToken(request({}), tokens[0]), false);
    assert.equal(isLocalRequest(request({ origin: 'https://evil.example' })), false);
    assert.equal(isLocalRequest(request({ host: 'evil.example' })), false);
    assert.equal(isReceptionReader(request({ 'sec-fetch-site': 'same-origin', 'x-dispatchpro-client': 'reception' })), true);
    assert.equal(isReceptionReader(request({ 'sec-fetch-site': 'cross-site', 'x-dispatchpro-client': 'reception' })), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real route handlers enforce auth, body limits, source validation and persistent duplicate responses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dispatchpro-route-test-'));
  const previousDirectory = process.env.DISPATCHPRO_LOCAL_DATA_DIR;
  const previousEnabled = process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED;
  process.env.DISPATCHPRO_LOCAL_DATA_DIR = directory;
  process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED = 'true';
  try {
    const { POST, GET } = await import('../src/app/api/calls/route.ts');
    const token = await localCallToken(directory);
    const event = { eventId: 'http-one', source: 'LANDLINE_ICALL', phone: '0000', timestamp: '2026-09-24T10:00:00Z', line: '1' };
    const request = (body, headers = {}, method = 'POST') => new Request('http://127.0.0.1:9005/api/calls', {
      method, headers: { host: '127.0.0.1:9005', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    assert.equal((await POST(request(event, { authorization: '' }))).status, 401);
    assert.equal((await POST(request(event, { origin: 'https://evil.example' }))).status, 403);
    assert.equal((await POST(request(event, { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await POST(request('x'.repeat(4097)))).status, 413);
    assert.equal((await POST(request({ ...event, source: 'UNKNOWN' }))).status, 400);
    assert.equal((await POST(request(event))).status, 201);
    const duplicate = await POST(request(event));
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal((await POST(request({ ...event, phone: '1111' }))).status, 409);
    assert.equal((await POST(request({ ...event, eventId: 'http-two' }))).status, 201);
    assert.equal((await GET(request(null, { authorization: '' }, 'GET'))).status, 401);
    const reader = await GET(request(null, { authorization: '', 'sec-fetch-site': 'same-origin', 'x-dispatchpro-client': 'reception' }, 'GET'));
    assert.equal(reader.status, 200);
    assert.equal((await reader.json()).latest.event.source, 'LANDLINE_ICALL');
    for (const source of ['WHATSAPP', 'MANUAL', 'CUSTOMER_APP']) assert.equal((await POST(request({ ...event, source, eventId: source }))).status, 201);
  } finally {
    if (previousDirectory === undefined) delete process.env.DISPATCHPRO_LOCAL_DATA_DIR; else process.env.DISPATCHPRO_LOCAL_DATA_DIR = previousDirectory;
    if (previousEnabled === undefined) delete process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED; else process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED = previousEnabled;
    await rm(directory, { recursive: true, force: true });
  }
});
