import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');

// One checkpoint per event and per authenticated tenant. A lost ACK is safely replayed.
export function createReceptionWorker({ directory, apiUrl, tenant, username, password, expectedTenantId, bridge = false, immutableInbox=false, fetchImpl = fetch, report = () => {} }) {
  const url = new URL(apiUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS for a remote API');
  const base = url.href.replace(/\/$/, '');
  let token, expiresAt = 0, officeId, checkpointDirectory;
  const acknowledgedFiles=new Set(),pendingRecords=new Map();
  function rememberAck(file){if(immutableInbox){acknowledgedFiles.add(file);pendingRecords.delete(file);}}
  async function authenticate() {
    if (token && Date.now() < expiresAt) return;
    const login = await fetchImpl(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant, username, password }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!login.ok) throw new Error(`Worker login failed (${login.status})`);
    const auth = await login.json();
    token = auth.accessToken;
    const me = await fetchImpl(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!me.ok) { token = undefined; throw new Error(`Worker identity failed (${me.status})`); }
    const identity = await me.json();
    if (!identity.tenantId || (expectedTenantId && expectedTenantId !== identity.tenantId) || (officeId && officeId !== identity.tenantId)) { token = undefined; throw new Error('Worker tenant identity changed'); }
    officeId = identity.tenantId;
    checkpointDirectory = join(directory, 'reception-worker', digest(`${base}\n${officeId}`));
    await mkdir(checkpointDirectory, { recursive: true });
    expiresAt = Date.now() + Math.max(1, Number(auth.expiresIn) - 60) * 1000;
  }
  async function runOnce() {
    await authenticate();
    const calls = join(directory, 'calls'); await mkdir(calls, { recursive: true });
    const files = (await readdir(calls)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)&&!(immutableInbox&&acknowledgedFiles.has(name))).sort();
    if (bridge) {
      const times = new Map();
      for (const file of files) { try { const record = pendingRecords.get(file)||JSON.parse(await readFile(join(calls, file), 'utf8'));if(immutableInbox)pendingRecords.set(file,record);times.set(file, Date.parse(record.event?.timestamp) || 0); } catch { times.set(file, 0); } }
      files.sort((a,b) => times.get(a) - times.get(b) || a.localeCompare(b));
    }
    let delivered = 0, failed = 0;
    for (const file of files) {
      try {
        const record = pendingRecords.get(file)||JSON.parse(await readFile(join(calls, file), 'utf8'));
        if(immutableInbox)pendingRecords.set(file,record);
        const event = record.event;
        if (!event || digest(event.eventId) !== file.slice(0, -5)) throw new Error('Invalid journal record');
        const hash = digest(JSON.stringify(event));
        const target = join(checkpointDirectory, file);
        let acknowledged;
        try { acknowledged = JSON.parse(await readFile(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (acknowledged?.hash === hash) {rememberAck(file);continue;}
        const payload = bridge ? { source: event.source === 'LANDLINE_ICALL' ? 'LANDLINE' : event.source, callerNumber: event.phone, eventId: event.eventId, receivedAt: event.timestamp, tenantId: officeId, line: event.line, location: event.location } : event;
        if (bridge && event.source === 'WHATSAPP') { payload.siteId = event.siteId; payload.officeId = event.officeId; }
        const response = await fetchImpl(`${base}/api/v1/reception/${bridge ? 'bridge/calls' : 'calls'}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) { if (response.status === 401) { token = undefined; expiresAt = 0; } throw new Error(`Ingestion failed (${response.status})`); }
        const acknowledgement = await response.json();
        if (acknowledgement.eventId !== event.eventId) throw new Error('Invalid ingestion acknowledgement');
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ hash }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
        rememberAck(file);
        delivered++;
      } catch (error) { failed++; report({ file, error: error.message }); }
    }
    return { delivered, failed };
  }
  return { runOnce };
}
