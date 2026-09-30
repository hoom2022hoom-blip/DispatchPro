import { readFile, readdir, mkdir, appendFile, stat, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createCallStore } from '../../src/lib/call-store.ts';
import { parseCallEvent } from '../../src/lib/call-events.ts';
import { createReceptionWorker, digest } from './reception-worker.mjs';

// Observe the existing immutable inbox. Never bind iCall's UDP port or modify its files.
export function createOfficeBridge(config, credentials, { fetchImpl = fetch, report = () => {} } = {}) {
  const directory = resolve(config.stateDirectory);
  const source = resolve(config.sourceDirectory);
  if (source === directory || directory.startsWith(source + '/') || directory.startsWith(source + '\\')) throw Error('Separate source and state directories required');
  if (!config.tenant || !/^[a-f0-9-]{36}$/i.test(config.tenantId) || !Number.isFinite(Date.parse(config.startAfter))) throw Error('Office identity and startAfter required');
  if (!credentials.username || !credentials.password) throw Error('Credentials required');
  const store = createCallStore(join(directory, 'calls'));
  const importedFiles = new Set();
  const binding = JSON.stringify({ apiUrl: new URL(config.apiUrl).href, tenant: config.tenant, tenantId: config.tenantId, source: config.sourceDirectory });
  const worker = createReceptionWorker({ directory, apiUrl: config.apiUrl, tenant: config.tenant, expectedTenantId: config.tenantId, ...credentials, bridge: true, fetchImpl, report: () => report({ type: 'delivery_retry' }) });
  return { async runOnce() {
    await mkdir(directory, { recursive: true });
    const manifest = join(directory, 'office-binding.json');
    try { await writeFile(manifest, binding, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (await readFile(manifest, 'utf8') !== binding) throw Error('State directory belongs to a different office or source');
    let imported = 0, rejected = 0;
    let files;
    try { files = await readdir(source); } catch { report({ type: 'source_unavailable' }); files = []; rejected++; }
    for (const file of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f)).sort()) {
      if (importedFiles.has(file)) continue;
      try {
        const path = join(source, file);
        if ((await stat(path)).size > 16384) throw Error('Oversized record');
        const record = JSON.parse(await readFile(path, 'utf8'));
        if (!Number.isFinite(Date.parse(record.receivedAt))) throw Error('Invalid journal time');
        if (Date.parse(record.receivedAt) < Date.parse(config.startAfter)) continue;
        if (!['LANDLINE_ICALL', 'WHATSAPP'].includes(record.event?.source)) continue;
        const event = parseCallEvent(record.event);
        if (digest(event.eventId) !== file.slice(0,-5)) throw Error('Invalid journal key');
        if (!(await store.append(event)).duplicate) imported++;
        importedFiles.add(file);
      } catch { rejected++; report({ type: 'source_record_rejected' }); }
    }
    try { return { imported, rejected, ...await worker.runOnce() }; }
    catch { report({ type: 'api_unavailable_or_identity_rejected' }); return { imported, rejected, delivered: 0, failed: 1 }; }
  } };
}

export async function bridgeLogger(directory) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'agent.log');
  return async record => {
    try {
      if ((await stat(file).catch(() => ({ size: 0 }))).size > 1048576) {
        await rm(file + '.1', { force: true }); await rename(file, file + '.1');
      }
      // Only agent-owned categories and aggregate counters, never error messages or payloads.
      await appendFile(file, JSON.stringify({ at: new Date().toISOString(), type: record.type, imported: record.imported, rejected: record.rejected, delivered: record.delivered, failed: record.failed }) + '\n', { mode: 0o600 });
    } catch { /* Logging must not stop capture/retry. */ }
  };
}
