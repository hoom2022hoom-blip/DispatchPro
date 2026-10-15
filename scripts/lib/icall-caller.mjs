import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseIcallPacket } from './icall-udp.mjs';

// Until complete device records are supplied, accept only two matching phone
// fields at the payload tail. Never search date/time/header digits for a phone.
const digit = '[ -]*[0-9]';
const phone = `(?:0[ -]*5(?:${digit}){8}|0[ -]*9(?:${digit}){7})`;
const tailPair = new RegExp(`(?:^|[^0-9-])(${phone})[ \\t\\0|,;]+(${phone})[ \\t\\r\\n\\0\\x03|,;]*$`);
export function parseCaller(payload) {
  const text = payload.subarray(Math.max(0, payload.length - 96)).toString('latin1');
  const match = tailPair.exec(text);
  if (!match) return null;
  const first = match[1].replace(/[ -]/g, '');
  const second = match[2].replace(/[ -]/g, '');
  if (first !== second) return null;
  return { phone: first };
}

export async function createCallerProcessor({ directory, send, sourceIp: expectedSourceIp = '192.168.0.90', onCall = () => {}, clock = () => Date.now(), quietMs = 8000 }) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'caller-state.json');
  let state = { recent: {}, pending: {} };
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state.recent || !state.pending) throw new Error('Invalid caller state; keep the file for recovery');
  let queue = Promise.resolve();
  const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function commit(next) {
    const temp = join(directory, `caller-${randomUUID()}.tmp`);
    try { await writeFile(temp, JSON.stringify(next), { mode: 0o600 }); await rename(temp, file); state = next; }
    finally { await rm(temp, { force: true }); }
  }
  let flushing;
  return {
    pendingIds() { return serial(() => Object.keys(state.pending)); },
    receive(payload, sourceIp, timestamp = new Date(clock()).toISOString()) {
      return serial(async () => {
        if (sourceIp !== expectedSourceIp) return null;
        const record = parseIcallPacket(payload);
        if (record?.phase === 'E') {
          const next = structuredClone(state);
          for (const [key, item] of Object.entries(next.recent)) {
            if ((item.line === record.line && item.stamp === record.stamp || (!item.line && record.phone === item.event.phone)) && (!record.phone || item.event.phone === record.phone)) delete next.recent[key];
          }
          await commit(next);
          return { ended: true, duplicate: true };
        }
        const parsed = record?.phase === 'S' ? { phone: record.phone } : parseCaller(payload);
        if (!parsed) return null;
        const now = clock(), key = `${sourceIp}:${record?.line ? record.line + ':' : ''}${parsed.phone}`;
        const next = structuredClone(state), previous = next.recent[key];
        const duplicate = previous && (record ? previous.stamp === record.stamp && new Date(previous.event.timestamp).getUTCFullYear() === new Date(now).getUTCFullYear() : now - previous.lastSeen <= quietMs);
        const event = duplicate ? previous.event : { eventId: `icall-${randomUUID()}`, source: 'LANDLINE_ICALL', phone: parsed.phone, timestamp, ...(record ? { line: record.line } : {}) };
        next.recent[key] = { lastSeen: now, event, ...(record ? { line: record.line, stamp: record.stamp } : {}) };
        for (const [oldKey, item] of Object.entries(next.recent)) if (!item.line && now - item.lastSeen > quietMs && oldKey !== key) delete next.recent[oldKey];
        if (!duplicate) next.pending[event.eventId] = event;
        await commit(next);
        if (!duplicate) onCall({ event, sourceIp });
        return { event, duplicate: Boolean(duplicate) };
      });
    },
    retry() {
      if (flushing) return flushing;
      flushing = (async () => {
        const pending = await serial(() => Object.values(state.pending));
        for (const event of pending) {
          await send(event);
          await serial(async () => { const next = structuredClone(state); delete next.pending[event.eventId]; await commit(next); });
        }
      })().finally(() => { flushing = undefined; });
      return flushing;
    },
  };
}
