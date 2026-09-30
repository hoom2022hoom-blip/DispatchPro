import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import { listenRaw } from './scripts/lib/icall-raw.mjs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createCallerProcessor } from './scripts/lib/icall-caller.mjs';
import { sendCall } from './scripts/send-call.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const callerDirectory = join(process.env.DISPATCHPRO_LOCAL_DATA_DIR || join(root, 'data'), 'caller');
try {
  const config = JSON.parse(await readFile(join(root, 'integration-config.json'), 'utf8'));
  if (config.dataDirectory) process.env.DISPATCHPRO_LOCAL_DATA_DIR = resolve(root, config.dataDirectory);
} catch (error) { if (error.code !== 'ENOENT') { console.error(`Invalid integration-config.json: ${error.message}`); process.exit(1); } }
await import('./server.mjs');
const processor = await createCallerProcessor({
  directory: callerDirectory,
  send: async event => { const result = await sendCall(event); console.log(`CALL INTEGRATION: ${result.duplicate ? 'duplicate acknowledged' : 'accepted'} | ${event.eventId}`); },
  onCall: ({ event, sourceIp }) => console.log(`CALLER\t${event.phone}\t${event.timestamp}\t${sourceIp}`),
});
function retry() { void processor.retry().catch(error => console.error(`CALL INTEGRATION RETRY PENDING: ${error.message}`)); }
async function receive(payload, sourceIp, timestamp) {
  const result = await processor.receive(payload, sourceIp, timestamp);
  if (!result && sourceIp === '192.168.0.90') console.log('PARSER: no matching repeated phone fields at payload tail; raw packet retained.');
  if (result && !result.ended) retry();
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try {
    const item = JSON.parse(line);
    if (typeof item.hex !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(item.hex) || item.hex.length > 131070 || item.sourceIp !== '192.168.0.90' || !Number.isFinite(Date.parse(item.timestamp))) throw new Error('Invalid capture message');
    void receive(Buffer.from(item.hex, 'hex'), item.sourceIp, item.timestamp).catch(error => console.error(`PARSER ERROR: ${error.message}`));
  } catch (error) { console.error(`CAPTURE MESSAGE ERROR: ${error.message}`); }
});
setInterval(retry, 5000).unref();
retry();

const logFile = fileURLToPath(new URL('../icall-raw.log', import.meta.url));
const persist = process.env.DISPATCHPRO_RAW_LOG_OWNER !== 'launcher';
try { if (persist) appendFileSync(logFile, `\nDEBUG SESSION ${new Date().toISOString()}\n`, 'utf8'); }
catch (error) { console.error(`Cannot create icall-raw.log: ${error.message}`); process.exit(1); }
console.log('LANDLINE iCALL — caller parser + raw DEBUG');
console.log('Raw UDP accepts all sources; caller parser accepts iCall 192.168.0.90. Known I/E closes the call; unstructured packets use 8 seconds of silence.');
console.log(`Raw log: ${logFile}`);
const socket = listenRaw({ logFile, persist, onPacket: receive, onError: error => console.error(error.message) });
socket.on('listening', () => console.log('UDP FALLBACK READY: listening on UDP 0.0.0.0:3520. Ethernet capture readiness is reported separately as CAPTURE READY.'));
socket.on('error', () => { socket.close(); process.exitCode = 1; });
if (process.env.DISPATCHPRO_LAUNCHER_PID) setInterval(() => {
  try { process.kill(Number(process.env.DISPATCHPRO_LAUNCHER_PID), 0); }
  catch { process.exit(0); }
}, 1000).unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => socket.close());
