/* ═══════════════════════════════════════════════════
   PACERUN — Service Worker
   Cache estratégico para funcionamento offline
   ═══════════════════════════════════════════════════ */

const CACHE_NAME = 'pacerun-v2';
const PRECACHE = [
  '/pacerun/',
  '/pacerun/index.html',
  '/pacerun/css/app.css',
  '/pacerun/js/app.js',
  '/pacerun/manifest.json',
];

// Install: pre-cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Cache-first para assets, network-first para API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Não intercepta Firebase ou APIs externas
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('anthropic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('nominatim') ||
      url.hostname.includes('tile.openstreetmap')) {
    return;
  }

  // Cache-first para assets locais
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
