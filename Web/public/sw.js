/* REAPER Remote Mixer PWA SW (rm-pwa-v1.2.6-fix7-hybrid-fix6-u24a) */
const CACHE = 'rm-pwa-v1.2.6-fix7-hybrid-fix6-u24a';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    }catch{}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Don't interfere with websockets or non-GET.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.startsWith('/ws')) return;

  // Navigation: network-first to keep UI fresh.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try{
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/index.html', net.clone()).catch(()=>{});
        return net;
      }catch{
        const cached = await caches.match('/index.html');
        return cached || caches.match('/');
      }
    })());
    return;
  }

  // Cache-first for static assets.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try{
      const net = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, net.clone()).catch(()=>{});
      return net;
    }catch{
      return cached;
    }
  })());
});


// fix-strips-2026-01-23
const _RM_NET_FIRST = true;
self.addEventListener('fetch', (event)=>{
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('/scripts/app.js') || url.pathname.endsWith('/index.html') || url.pathname === '/'){
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
    return;
  }
});
