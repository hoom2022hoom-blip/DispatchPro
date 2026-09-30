// The proxy forwards each employee's JWT; it never upgrades access using a shared account.
export async function proxyReception(request: Request, path: string[], base: string | undefined, fetchImpl: typeof fetch = fetch) {
  const route = path.join('/');
  const updates = route === 'driver/updates' || route === 'notifications/updates' || (route === 'reception/snapshot' && new URL(request.url).searchParams.get('wait') === 'true');
  const allowed = (request.method === 'PUT' && (route === 'driver/location' || route === 'dispatch/policy' || /^dispatch\/rides\/[a-f0-9-]{36}\/mode$/.test(route))) || (request.method === 'GET' && ['dispatch/policy','dispatch/rides'].includes(route)) || (request.method === 'GET' && (updates || ['driver/me','driver/history'].includes(route) || /^driver\/rides\/[a-f0-9-]{36}$/.test(route))) ||
    (request.method === 'PUT' && (route === 'driver/availability' || /^driver\/rides\/[a-f0-9-]{36}\/reject$/.test(route) || /^rides\/[a-f0-9-]{36}\/status$/.test(route))) ||
    (request.method === 'PUT' && route === 'office/messaging-settings') || (request.method === 'GET' && route === 'office') ||
    (request.method === 'GET' && ['administration/access','administration/users','administration/roles','administration/notifications','offices'].includes(route)) ||
    (request.method === 'POST' && ['users','roles','offices'].includes(route)) ||
    (request.method === 'PUT' && /^(administration\/(users|roles)|offices)\/[a-f0-9-]{36}$/.test(route)) ||
    (request.method === 'GET' && ['reception/reports/drivers', 'reception/reports/history'].includes(route)) ||
    (request.method === 'GET' && /^office\/drivers\/[a-f0-9-]{36}\/assignments$/.test(route)) ||
    (request.method === 'POST' && ['office/queue','office/queue-locations'].includes(route)) ||
    (request.method === 'PUT' && /^office\/queue-locations\/[a-f0-9-]{36}$/.test(route)) ||
    (request.method === 'POST' && /^office\/(drivers|vehicles)$/.test(route)) ||
    (request.method === 'PUT' && /^office\/(drivers|vehicles)\/[a-f0-9-]{36}$/.test(route)) ||
    (request.method === 'POST' && /^office\/drivers\/[a-f0-9-]{36}\/queue$/.test(route)) ||
    (request.method === 'POST' && (route === 'auth/login' || /^reception\/(calls|queue|shifts)$/.test(route) || /^reception\/shifts\/[a-f0-9-]{36}\/end$/.test(route))) ||
    (request.method === 'GET' && ['reception/snapshot', 'reception/latest-call', 'customers', 'saved-addresses'].includes(route)) ||
    (request.method === 'POST' && ['customers', 'saved-addresses'].includes(route)) ||
    (request.method === 'GET' && /^customers\/[a-f0-9-]{36}$/.test(route)) ||
    (request.method === 'PUT' && /^customers\/[a-f0-9-]{36}$/.test(route)) ||
    (['GET', 'PUT', 'DELETE'].includes(request.method) && /^saved-addresses\/[a-f0-9-]{36}$/.test(route)) ||
    (request.method === 'PUT' && /^reception\/rides\/[a-zA-Z0-9_-]{1,180}$/.test(route));
  if (!base || !allowed) return Response.json({ error: 'Reception API route unavailable' }, { status: 404 });
  const origin = request.headers.get('origin');
  // Next.js can reconstruct request.url with localhost while the browser used
  // 127.0.0.1. Host preserves the actual HTTP authority; forwarded headers do not.
  const requestUrl = new URL(request.url);
  const authority = request.headers.get('host');
  const expectedOrigin = authority ? `${requestUrl.protocol}//${authority}` : requestUrl.origin;
  if (origin && origin !== expectedOrigin) return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const authorization = request.headers.get('authorization');
  if (route !== 'auth/login' && !authorization?.startsWith('Bearer ')) return Response.json({ error: 'Authentication required' }, { status: 401 });
  let body: Uint8Array | undefined;
  if (request.method !== 'GET') {
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > 131072) { await reader.cancel(); return Response.json({ error: 'Request too large' }, { status: 413 }); } chunks.push(result.value); }
    if (size) { body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; } }
  }
  try {
    const target = new URL(base);
    if (target.username || target.password || target.search || target.hash || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)))) throw new Error('Invalid API URL');
    const query = new URL(request.url).search;
    const upstream = await fetchImpl(`${target.href.replace(/\/$/, '')}/api/v1/${route}${query}`, {
      method: request.method, headers: { ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'application/json', ...(request.headers.has('if-none-match') ? { 'If-None-Match': request.headers.get('if-none-match')! } : {}) },
      body: body as BodyInit | undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(updates ? 35000 : 15000)]),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store', ...(upstream.headers.has('etag') ? { ETag: upstream.headers.get('etag')! } : {}) } });
  } catch { return Response.json({ error: 'تعذر الاتصال بخادم المكتب' }, { status: 503 }); }
}
