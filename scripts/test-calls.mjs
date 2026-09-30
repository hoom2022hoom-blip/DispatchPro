import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { sendCall } from './send-call.mjs';

// Simulation only: no phone/device integration and no changes to existing orders.
const automatic = process.argv.includes('--auto');
const terminal = automatic ? null : createInterface({ input: stdin, output: stdout });
const run = randomUUID();
const event = {
  eventId: `visual-${run}-1`, source: 'LANDLINE_ICALL', phone: '0000',
  timestamp: new Date().toISOString(), line: 'SIMULATION',
};
async function step(message, value, duplicate) {
  console.log(`\n${message}`);
  if (terminal) await terminal.question('Press Enter to send, then check the reception table... ');
  const result = await sendCall(value);
  assert.equal(result.duplicate, duplicate);
  console.log(JSON.stringify(result));
}
try {
  console.log('Open http://127.0.0.1:9005 and keep the reception table visible. Test phone: 0000.');
  await step('1/4 LANDLINE_ICALL: expect ONE new reception order.', event, false);
  await step('2/4 Same eventId and payload: expect NO additional order.', event, true);
  await step('3/4 Same phone, NEW eventId: expect ONE additional landline order.', { ...event, eventId: `visual-${run}-2` }, false);
  await step('4/4 WHATSAPP: expect ONE additional order with W.', { ...event, eventId: `visual-${run}-3`, source: 'WHATSAPP' }, false);
  console.log('\nPASS: event acceptance/deduplication. Expected visible increase: 3 orders total (2 landline, 1 W).');
  console.log('Orders remain available for inspection; no existing data was deleted.');
} finally { terminal?.close(); }
