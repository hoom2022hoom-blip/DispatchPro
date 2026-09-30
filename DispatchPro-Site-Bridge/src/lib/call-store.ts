import { mkdir, writeFile, readFile, readdir, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { CallEvent } from './call-events';

export type StoredCall = { event: CallEvent; receivedAt: string };

// Immutable files + atomic hard links provide cross-process idempotency, including restarts.
export function createCallStore(directory: string) {
  const knownFiles = new Set<string>();
  let cachedLatest: StoredCall | null = null;
  return {
    async all(): Promise<StoredCall[]> {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
      const records = await Promise.all(files.map(async file => JSON.parse(await readFile(join(directory, file), 'utf8')) as StoredCall));
      return records.sort((a, b) => Date.parse(a.event.timestamp) - Date.parse(b.event.timestamp) || a.event.eventId.localeCompare(b.event.eventId));
    },
    async append(event: CallEvent) {
      await mkdir(directory, { recursive: true });
      const key = createHash('sha256').update(event.eventId).digest('hex');
      const target = join(directory, `${key}.json`);
      const temporary = join(directory, `${key}.${randomUUID()}.tmp`);
      const record: StoredCall = { event, receivedAt: new Date().toISOString() };
      await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      try {
        await link(temporary, target);
        return { duplicate: false, record };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing: StoredCall = JSON.parse(await readFile(target, 'utf8'));
        if (JSON.stringify(existing.event) !== JSON.stringify(event)) throw new Error('EVENT_ID_CONFLICT');
        return { duplicate: true, record: existing };
      } finally {
        await unlink(temporary);
      }
    },
    async latest(): Promise<StoredCall | null> {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
      if (files.length < knownFiles.size) { knownFiles.clear(); cachedLatest = null; }
      for (const file of files) {
        if (knownFiles.has(file)) continue;
        const item: StoredCall = JSON.parse(await readFile(join(directory, file), 'utf8'));
        if (!cachedLatest || Date.parse(item.event.timestamp) > Date.parse(cachedLatest.event.timestamp) || (Date.parse(item.event.timestamp) === Date.parse(cachedLatest.event.timestamp) && item.event.eventId > cachedLatest.event.eventId)) cachedLatest = item;
        knownFiles.add(file);
      }
      return cachedLatest;
    },
  };
}
