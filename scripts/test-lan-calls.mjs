import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { lanInterfaces } from './call-lan-server.mjs';

const address = process.env.DISPATCHPRO_LAN_IP || (lanInterfaces().length === 1 ? lanInterfaces()[0].address : null);
if (!address) throw new Error('Set DISPATCHPRO_LAN_IP');
const url = `http://${address}:${process.env.DISPATCHPRO_LAN_PORT || 9006}/api/calls`;
const token = process.env.DISPATCHPRO_CALL_TOKEN || (await readFile(resolve(process.env.DISPATCHPRO_LOCAL_DATA_DIR || '.dispatchpro-local', 'call-token'), 'utf8')).trim();
const event = { eventId: `lan-check-${randomUUID()}`, source: 'WHATSAPP', phone: '0000', timestamp: new Date().toISOString(), line: 'LAN_TEST' };
async function send(value) {
  return fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(20000) });
}
assert.equal((await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) })).status, 401);
assert.equal((await send(event)).status, 201);
const duplicate = await send(event);
assert.equal(duplicate.status, 200);
assert.equal((await duplicate.json()).duplicate, true);
assert.equal((await send({ ...event, phone: '1111' })).status, 409);
const next = { ...event, eventId: `${event.eventId}-next` };
assert.equal((await send(next)).status, 201);
const feed = await (await fetch('http://127.0.0.1:9005/api/calls', { headers: { authorization: `Bearer ${token}` } })).json();
assert.equal(feed.events.filter(record => [event.eventId, next.eventId].includes(record.event.eventId)).length, 2);
assert.equal(feed.latest.event.eventId, next.eventId);
console.log(`PASS ${url}: authentication, WHATSAPP, duplicate event, conflict, new event for same phone, shared office inbox. Two test calls (0000) retained.`);
