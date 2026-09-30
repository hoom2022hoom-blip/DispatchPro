import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function lanInterfaces() {
  return Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address));
}

function sameSubnet(peer, address, mask) {
  const parts = peer?.replace(/^::ffff:/, '').split('.');
  if (parts?.length !== 4) return false;
  const network = address.split('.'), bits = mask.split('.');
  return parts.every((part, index) => (Number(part) & Number(bits[index])) === (Number(network[index]) & Number(bits[index])));
}

// Expose only authenticated call ingestion, never the development admin UI or call history.
export function createLanCallServer({ address, netmask, upstream = 'http://127.0.0.1:9005/api/calls' }) {
  const target = new URL(upstream);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('Upstream must be loopback');
  const server = createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (!sameSubnet(request.socket.remoteAddress, address, netmask)) return reply(403, { error: 'Local subnet only' });
    if (request.headers.origin || request.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Native adapter only' });
    if (request.url === '/health' && request.method === 'GET') return reply(200, { status: 'listening', service: 'call-lan' });
    if (request.url !== '/api/calls') return reply(404, { error: 'Not found' });
    if (request.method !== 'POST') return reply(405, { error: 'POST only' });
    if (!request.headers.authorization?.startsWith('Bearer ')) return reply(401, { error: 'Bearer token required' });
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(415, { error: 'Use application/json' });
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4096) { reply(413, { error: 'Event exceeds 4096 bytes' }); return; }
        chunks.push(chunk);
      }
      const result = await fetch(target, {
        method: 'POST', headers: { authorization: request.headers.authorization, 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks), signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      reply(result.status, await result.json());
    } catch { if (!response.headersSent) reply(503, { error: 'Office endpoint unavailable; retry the identical event' }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const interfaces = lanInterfaces();
  const selected = process.env.DISPATCHPRO_LAN_IP
    ? interfaces.find(item => item.address === process.env.DISPATCHPRO_LAN_IP)
    : interfaces.length === 1 ? interfaces[0] : undefined;
  if (!selected) throw new Error('Set DISPATCHPRO_LAN_IP to one of the computer private IPv4 addresses');
  const port = Number(process.env.DISPATCHPRO_LAN_PORT || 9006);
  const server = createLanCallServer(selected);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, selected.address, () => console.log(`Android endpoint: http://${selected.address}:${port}/api/calls (Bearer token required)`));
}
