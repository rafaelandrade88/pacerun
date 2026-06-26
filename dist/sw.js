/* ═══════════════════════════════════════════════════
   PACERUN — Service Worker v1.8.2
   ═══════════════════════════════════════════════════ */

const APP_VERSION = 'v1.8.2';
const CACHE_NAME = `pacerun-${APP_VERSION}`;

const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/manifest.json',
];

// Install: pré-cache dos assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting(); // força ativação imediata
});

// Activate: APAGA TODOS os caches antigos (pacerun-v1, pacerun-v2, etc.)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      console.log('[SW v1.8.2] Caches encontrados:', keys);
      return Promise.all(
        keys
          .filter(k => k !== CACHE_NAME) // deleta tudo exceto o atual
          .map(k => {
            console.log('[SW v1.8.2] Deletando cache antigo:', k);
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim(); // assume controle de todas as abas
});

// Fetch: network-first para garantir sempre versão atualizada
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignora schemes não cacheáveis (chrome-extension, data, blob, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Não intercepta APIs externas
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('anthropic') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('nominatim') ||
    url.hostname.includes('cloudinary') ||
    url.hostname.includes('allorigins') ||
    url.hostname.includes('tile.openstreetmap') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('ui-avatars.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    return;
  }

  // Network-first: tenta buscar da rede sempre, fallback para cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        if (url.protocol.startsWith('http')) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// Responde mensagens do app
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});
