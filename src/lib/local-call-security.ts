import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function isLocalRequest(request: Request) {
  const url = new URL(request.url);
  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  const host = request.headers.get('host');
  if (!hosts.includes(url.hostname) || !host) return false;
  try { if (!hosts.includes(new URL(`http://${host}`).hostname)) return false; } catch { return false; }
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}

export function isReceptionReader(request: Request) {
  return isLocalRequest(request) && request.headers.get('sec-fetch-site') === 'same-origin' &&
    request.headers.get('x-dispatchpro-client') === 'reception';
}

export function validToken(request: Request, token: string) {
  const actual = request.headers.get('authorization') ?? '';
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(`Bearer ${token}`).digest());
}

export async function localCallToken(directory: string) {
  const configured = process.env.DISPATCHPRO_CALL_TOKEN;
  if (configured) {
    if (configured.length < 32) throw new Error('Call token must contain at least 32 characters');
    return configured;
  }
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'call-token');
  try { return (await readFile(file, 'utf8')).trim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(directory, `token-${randomBytes(16).toString('hex')}.tmp`);
  const token = randomBytes(32).toString('hex');
  await writeFile(temporary, token, { flag: 'wx', mode: 0o600 });
  try { await link(temporary, file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally { await unlink(temporary); }
  return (await readFile(file, 'utf8')).trim();
}
