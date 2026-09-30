import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createSocket } from 'node:dgram';
import assert from 'node:assert/strict';
import { createIcallProcessor, listenIcall } from '../app/scripts/lib/icall-udp.mjs';
import { sendCall } from '../app/scripts/send-call.mjs';
const dir = await mkdtemp(join(tmpdir(), 'icall-release-test-'));
process.env.DISPATCHPRO_LOCAL_DATA_DIR = dir;
const child = spawn(resolve('release-test/runtime/node.exe'), [resolve('release-test/app/server.mjs')], { env: { ...process.env, DISPATCHPRO_CALL_TOKEN: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
let socket, client;
try {
  for (let i = 0; i < 100 && !output.includes('LANDLINE_ICALL listening'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(output, /LANDLINE_ICALL listening/, output);
  assert.equal((await fetch('http://127.0.0.1:9005/')).status, 200);
  const errors = [];
  const processor = await createIcallProcessor({ directory: join(dir, 'test-adapter'), sourceIp: '127.0.0.1', send: sendCall });
  socket = listenIcall(processor, { host: '127.0.0.1', port: 0, onError: e => errors.push(e) });
  await once(socket, 'listening');
  client = createSocket('udp4');
  const packet = Buffer.from('01 I S 0000 G 01 09/25 10:00 AM ' + '092345678'.padEnd(15) + 'Test'.padEnd(15));
  await new Promise((resolve, reject) => client.send(packet, socket.address().port, '127.0.0.1', e => e ? reject(e) : resolve()));
  let records;
  for (let i = 0; i < 50; i++) {
    const response = await fetch('http://127.0.0.1:9005/api/calls', { headers: { 'sec-fetch-site': 'same-origin', 'x-dispatchpro-client': 'reception' } });
    records = await response.json();
    if (records.events?.length) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(records.events.length, 1);
  assert.equal(records.events[0].event.phone, '092345678');
  assert.equal(records.events[0].event.source, 'LANDLINE_ICALL');
  await processor.retry();
  assert.deepEqual(errors, []);
  console.log('PASS: bundled runtime, server, UDP adapter, existing API, storage and viewer data. Production listener bound UDP 3520; synthetic sender used an isolated loopback test port.');
} finally {
  client?.close(); socket?.close();
  if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  await rm(dir, { recursive: true, force: true });
}
