/* ═══════════════════════════════════════════════════
   PACERUN — Service Worker v1.8.5
   ═══════════════════════════════════════════════════ */

const APP_VERSION = 'v1.8.5';
const CACHE_NAME = `pacerun-${APP_VERSION}`;

// Detecta o base path automaticamente (funciona em / e em /pacerun/)
const BASE = self.registration.scope; // ex: https://host/pacerun/

const PRECACHE = [
  BASE,
  BASE + 'index.html',
  BASE + 'css/app.css',
  BASE + 'js/app.js',
  BASE + 'manifest.json',
];

// Install: pré-cache dos assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: apaga todos os caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Só processa GET sobre http/https — ignora chrome-extension://, POST, etc.
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Não intercepta APIs externas
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('nominatim') ||
    url.hostname.includes('cloudinary') ||
    url.hostname.includes('allorigins') ||
    url.hostname.includes('tile.openstreetmap') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('ui-avatars.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(request, clone))
          .catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached =>
          cached || (request.mode === 'navigate' ? caches.match(BASE + 'index.html') : undefined)
        )
      )
  );
});

// Mensagens do app
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});
