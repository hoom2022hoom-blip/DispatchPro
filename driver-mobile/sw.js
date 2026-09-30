// Network-only: never retain authenticated driver/customer data or replay writes.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => { event.respondWith(fetch(event.request)); });
