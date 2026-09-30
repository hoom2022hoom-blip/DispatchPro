import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallInbox } from '../src/lib/call-events.ts';

test('deduplicate event IDs while allowing later calls from the same phone', () => {
  const received = [];
  const accept = createCallInbox(event => received.push(event));
  const call = { eventId: 'one', source: 'WHATSAPP', phone: ' 0000 ', timestamp: '2026-09-24T10:00:00Z' };
  assert.equal(accept(call), true);
  assert.equal(accept(call), false);
  assert.equal(accept({ ...call, eventId: 'two', timestamp: '2026-09-24T10:01:00Z' }), true);
  assert.equal(received.length, 2);
  assert.equal(received[0].phone, '0000');
});

test('reject incomplete and invalid adapter payloads', () => {
  const accept = createCallInbox(() => assert.fail('invalid event delivered'));
  assert.equal(accept(null), false);
  assert.equal(accept({}), false);
  assert.equal(accept({ eventId: 'bad', source: 'WHATSAPP', phone: 123, timestamp: '2026-09-24T10:00:00Z' }), false);
  assert.equal(accept({ eventId: 'bad', source: 'LANDLINE_ICALL', phone: '0000', timestamp: 'invalid' }), false);
});
