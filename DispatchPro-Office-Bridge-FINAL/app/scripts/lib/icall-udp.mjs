import { createSocket } from 'node:dgram';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Format captured by the existing WindowsReceiver: 21-byte header + 62 ASCII bytes.
// The first 15-character field is the phone; the second is caller name, never a fallback phone.
export function parseIcallPacket(packet) {
  let record;
  if (packet.length === 83) {
    if (packet.subarray(0, 5).toString('ascii') !== '^^<U>') return null;
    record = packet.subarray(21);
  } else record = packet;
  if ([...record].some(byte => byte > 127)) return null;
  const text = record.toString('ascii').replace(/\r?\n$/, '');
  const match = /^(0[1-4]) ([IO]) ([ES]) (\d{4}) [GB] .\d (\d{2}\/\d{2} \d{2}:\d{2} [AP]M) (.{15})(.{15})$/.exec(text);
  if (!match || match[2] !== 'I') return null;
  const [, line, , phase, , stamp, phoneField] = match;
  const rawPhone = phoneField.trim();
  const phone = /^[+\d][\d ()-]*$/.test(rawPhone) ? rawPhone.replace(/[ ()-]/g, '') : '';
  if (phase === 'S' && !/^\+?\d{7,15}$/.test(phone)) return null;
  return { line, phase, stamp, phone };
}

export async function createIcallProcessor({ directory, send, sourceIp = '192.168.0.90', clock = () => new Date() }) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'state.json');
  let state = { active: {}, pending: {} };
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state.active || !state.pending) throw new Error('Invalid iCall state; preserve the file for recovery');
  const persist = async next => {
    const temp = join(directory, `state-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, file);
      state = next;
    } finally {
      await rm(temp, { force: true });
    }
  };
  // Serialize incoming records, end-of-call transitions and retries.
  let queue = Promise.resolve();
  const serial = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const flush = async () => {
    for (const [id, event] of Object.entries(state.pending)) {
      await send(event);
      const next = structuredClone(state);
      delete next.pending[id];
      await persist(next);
    }
  };
  return {
    receive(packet, remoteAddress) {
      return serial(async () => {
        if (remoteAddress !== sourceIp) return false;
        const call = parseIcallPacket(packet);
        if (!call) return false;
        const key = `${sourceIp}:${call.line}`;
        if (call.phase === 'E') {
          const active = state.active[key];
          // Do not let an old end packet close a newer call on the same line.
          if (active && active.stamp === call.stamp && (!call.phone || active.phone === call.phone)) {
            const next = structuredClone(state);
            delete next.active[key];
            await persist(next);
          }
          return false;
        }
        const now = clock();
        const signature = `${now.getFullYear()}:${call.stamp}:${call.phone}`;
        const previous = state.active[key];
        if (!previous || previous.signature !== signature) {
          const event = { eventId: `icall-${randomUUID()}`, source: 'LANDLINE_ICALL', phone: call.phone, timestamp: now.toISOString(), line: call.line };
          const next = structuredClone(state);
          next.active[key] = { signature, stamp: call.stamp, phone: call.phone, eventId: event.eventId };
          next.pending[event.eventId] = event;
          // Persist identity and payload before any network I/O, so restarts retry identically.
          await persist(next);
        }
        await flush();
        return true;
      });
    },
    retry() { return serial(flush); },
  };
}

export function listenIcall(processor, { port = 3520, host = '0.0.0.0', onError = console.error } = {}) {
  const socket = createSocket('udp4');
  socket.on('message', (packet, remote) => { void processor.receive(packet, remote.address).catch(onError); });
  socket.on('error', onError);
  socket.bind(port, host);
  return socket;
}
