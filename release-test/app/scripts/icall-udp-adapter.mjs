import { join } from 'node:path';
import { sendCall } from './send-call.mjs';
import { createIcallProcessor, listenIcall } from './lib/icall-udp.mjs';

const sourceIp = '192.168.0.90';
const processor = await createIcallProcessor({
  directory: join(process.env.DISPATCHPRO_LOCAL_DATA_DIR || '.dispatchpro-local', 'icall'),
  sourceIp,
  send: async event => {
    const result = await sendCall(event);
    console.log(`iCall line ${event.line}: ${result.duplicate ? 'duplicate acknowledged' : 'accepted'} ${event.eventId}`);
  },
});
const socket = listenIcall(processor, { onError: error => console.error(`iCall: ${error.message}`) });
let retry;
socket.on('listening', () => {
  console.log(`LANDLINE_ICALL listening on UDP 0.0.0.0:3520; accepts only ${sourceIp}; forwards to existing /api/calls`);
  retry = setInterval(() => { void processor.retry().catch(error => console.error(`iCall retry: ${error.message}`)); }, 5000);
});
socket.on('error', () => { clearInterval(retry); socket.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(retry); socket.close(); });
