import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.DISPATCHPRO_LOCAL_CALLS_ENABLED = 'true';
const port = Number(process.env.DISPATCHPRO_ICALL_HTTP_PORT || 9007);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local receiver port');
if (process.env.DISPATCHPRO_LAUNCHER_PID) setInterval(() => {
  try { process.kill(Number(process.env.DISPATCHPRO_LAUNCHER_PID), 0); }
  catch { process.exit(0); }
}, 1000).unref();
const route = await import('./route.mjs');
const page = await readFile(new URL('./index.html', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/' && req.method === 'GET' && req.headers.host === `127.0.0.1:${port}`) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page); return;
    }
    if (req.url !== '/api/calls' || !['GET', 'POST'].includes(req.method)) { res.writeHead(404); res.end(); return; }
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method, headers: req.headers,
      ...(req.method === 'POST' ? { body: req, duplex: 'half' } : {}),
    });
    const response = await route[req.method](request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end('Local test server error'); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') { console.error('Receiver HTTP port occupied; refusing to reuse an unrelated endpoint.'); process.exitCode = 1; }
  else console.error(`Call Integration server: ${error.message}`);
});
server.listen(port, '127.0.0.1', async () => {
  console.log(`Call Integration test viewer: http://127.0.0.1:${port}`);
  console.log('Existing Call Integration route active; caller events use the unchanged sendCall adapter.');
});
