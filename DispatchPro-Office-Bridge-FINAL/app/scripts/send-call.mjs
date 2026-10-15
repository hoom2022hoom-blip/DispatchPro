import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Adapter entry point for an existing WhatsApp/iCall process; reuse the same eventId on retries.
export async function sendCall(event, url = `http://127.0.0.1:${process.env.DISPATCHPRO_ICALL_HTTP_PORT || 9007}/api/calls`) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('Local endpoint required');
  const tokenFile = resolve(process.env.DISPATCHPRO_LOCAL_DATA_DIR || '.dispatchpro-local', 'call-token');
  let token = process.env.DISPATCHPRO_CALL_TOKEN;
  if (!token) {
    try { token = (await readFile(tokenFile, 'utf8')).trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Bootstrap the local secret without exposing it in an HTTP response.
      await fetch(target, { signal: AbortSignal.timeout(10000) });
      token = (await readFile(tokenFile, 'utf8')).trim();
    }
  }
  const response = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, phone, eventId = randomUUID(), line, timestamp = new Date().toISOString()] = process.argv.slice(2);
  if (!source || !phone) { console.error('Usage: npm run call:send -- SOURCE PHONE [EVENT_ID] [LINE] [ISO_TIMESTAMP]'); process.exitCode = 1; }
  else {
    try { console.log(await sendCall({ eventId, source, phone, timestamp, ...(line ? { line } : {}) })); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
