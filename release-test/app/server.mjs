import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED = 'true';
if (process.env.DISPATCHPRO_LAUNCHER_PID) setInterval(() => {
  try { process.kill(Number(process.env.DISPATCHPRO_LAUNCHER_PID), 0); }
  catch { process.exit(0); }
}, 1000).unref();
const route = await import('./route.mjs');
const page = await readFile(new URL('./index.html', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/' && req.method === 'GET' && req.headers.host === '127.0.0.1:9005') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page); return;
    }
    if (req.url !== '/api/calls' || !['GET', 'POST'].includes(req.method)) { res.writeHead(404); res.end(); return; }
    const request = new Request(`http://127.0.0.1:9005${req.url}`, {
      method: req.method, headers: req.headers,
      ...(req.method === 'POST' ? { body: req, duplex: 'half' } : {}),
    });
    const response = await route[req.method](request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end('Local test server error'); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.log('Call Integration already occupies localhost:9005; using its existing endpoint. The integration data directory must match its call-token directory.');
  else console.error(`Call Integration server: ${error.message}`);
});
server.listen(9005, '127.0.0.1', async () => {
  console.log('Call Integration test viewer: http://127.0.0.1:9005');
  console.log('Existing Call Integration route active; caller events use the unchanged sendCall adapter.');
});
