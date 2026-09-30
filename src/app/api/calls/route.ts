import { join } from 'node:path';
import { parseCallEvent } from '@/lib/call-events';
import { createCallStore } from '@/lib/call-store';
import { isLocalRequest, isReceptionReader, localCallToken, validToken } from '@/lib/local-call-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const directory = process.env.DISPATCHPRO_LOCAL_DATA_DIR || join(process.cwd(), '.dispatchpro-local');
const store = createCallStore(join(directory, 'calls'));
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const enabled = () => process.env.NODE_ENV === 'development' || process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED === 'true';

export async function GET(request: Request) {
  if (!enabled()) return respond({ error: 'Local call integration is disabled' }, 404);
  if (!isLocalRequest(request)) return respond({ error: 'Local requests only' }, 403);
  try {
    const token = await localCallToken(directory);
    if (!isReceptionReader(request) && !validToken(request, token)) return respond({ error: 'Unauthorized' }, 401);
    return respond({ latest: await store.latest(), events: await store.all() });
  } catch { return respond({ error: 'Call storage unavailable' }, 503); }
}

export async function POST(request: Request) {
  if (!enabled()) return respond({ error: 'Local call integration is disabled' }, 404);
  if (!isLocalRequest(request)) return respond({ error: 'Local requests only' }, 403);
  try {
    if (!validToken(request, await localCallToken(directory))) return respond({ error: 'Unauthorized' }, 401);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return respond({ error: 'Use application/json' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: 'Missing event' }, 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return respond({ error: 'Event exceeds 4096 bytes' }, 413); }
      chunks.push(result.value);
    }
    let event;
    try { event = parseCallEvent(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch { return respond({ error: 'Invalid call event' }, 400); }
    const result = await store.append(event);
    return respond({ eventId: event.eventId, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'EVENT_ID_CONFLICT') return respond({ error: 'eventId already belongs to a different event' }, 409);
    return respond({ error: 'Call storage unavailable' }, 503);
  }
}
