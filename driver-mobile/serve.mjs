import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { proxyReception } from '../src/lib/reception-proxy.ts';

const files = { 'maps.js':'text/javascript', 'maplibre-gl.js':'text/javascript', 'maplibre-gl.css':'text/css', 'index.html':'text/html; charset=utf-8', 'app.js':'text/javascript', 'app.css':'text/css', 'manifest.webmanifest':'application/manifest+json', 'sw.js':'text/javascript', 'install.js':'text/javascript', 'icon-192.png':'image/png', 'icon-512.png':'image/png' };
const apiBase = process.env.DISPATCHPRO_API_URL || 'http://127.0.0.1:9010';
export function driverTestServer() {
  return http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const url = new URL(req.url, `${protocol}://${host}`);
      const name = url.pathname.slice('/driver-mobile/'.length);
      if (url.pathname.startsWith('/driver-mobile/') && Object.hasOwn(files, name) && ['GET','HEAD'].includes(req.method)) {
        const data = await readFile(new URL(`../public/driver-mobile/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type':files[name] });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      const route = url.pathname.replace(/^\/api\/reception\//, '');
      const allowed = url.pathname.startsWith('/api/reception/') && (
        (req.method === 'POST' && route === 'auth/login') ||
        (req.method === 'GET' && (/^driver\/(me|history|updates)$/.test(route) || /^driver\/rides\/[a-f0-9-]{36}$/.test(route))) ||
        (req.method === 'PUT' && (route === 'driver/location' || route === 'driver/availability' || /^driver\/rides\/[a-f0-9-]{36}\/reject$/.test(route) || /^rides\/[a-f0-9-]{36}\/status$/.test(route))));
      if (!allowed) { res.writeHead(404); res.end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 131072) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const request = new Request(url, { method:req.method, headers:req.headers, signal:controller.signal,
        ...(size ? {body:Buffer.concat(chunks)} : {}) });
      const response = await proxyReception(request, route.split('/'), apiBase);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.headersSent) res.writeHead(503); res.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  driverTestServer().listen(9012, '127.0.0.1', () => console.log('Driver mobile test host: http://127.0.0.1:9012/driver-mobile/index.html'));
}
