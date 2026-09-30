// Shell only. Customer API traffic and all writes always use the network.
const cache='dispatchpro-customer-shell-v7';
self.addEventListener('install',event=>event.waitUntil(caches.open(cache).then(c=>c.addAll(['./index.html','./app.css','./app.js','./maps.js','./icon.svg','./manifest.webmanifest']))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/customer-mobile/'))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(cache).then(c=>c.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request).then(r=>r||Response.error())));});
