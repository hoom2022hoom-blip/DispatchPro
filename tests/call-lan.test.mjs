import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLanCallServer } from '../scripts/call-lan-server.mjs';

test('LAN gateway preserves payload/auth and duplicate responses; blocks history, origins and oversized bodies', async () => {
  let received;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.equal(request.headers.authorization, 'Bearer test-token');
    const body = Buffer.concat(chunks).toString();
    const duplicate = body === received;
    received = body;
    response.writeHead(duplicate ? 200 : 201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ duplicate }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = createLanCallServer({ address: '127.0.0.1', netmask: '255.0.0.0', upstream: `http://127.0.0.1:${upstream.address().port}/api/calls` });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${gateway.address().port}/api/calls`;
  const options = { method: 'POST', headers: { authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: 'lan-1', source: 'WHATSAPP', phone: '0000', timestamp: '2026-09-25T10:00:00Z' }) };
  try {
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { ...options, headers: {} })).status, 401);
    assert.equal((await fetch(url, { ...options, headers: { ...options.headers, origin: 'http://evil.example' } })).status, 403);
    assert.equal((await fetch(url, { ...options, body: 'x'.repeat(4097) })).status, 413);
    assert.equal((await fetch(url, options)).status, 201);
    const duplicate = await fetch(url, options);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(received, options.body);
  } finally {
    await Promise.all([gateway, upstream].map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
  }
});
