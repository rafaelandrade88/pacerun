/* ═══════════════════════════════════════════════════
   PACERUN — Service Worker v1.5.0
   Cache estratégico para funcionamento offline
   Atualizar CACHE_NAME a cada nova versão do app
   ═══════════════════════════════════════════════════ */

const APP_VERSION = 'v1.5.0';
const CACHE_NAME  = `pacerun-${APP_VERSION}`;

const PRECACHE = [
  '/pacerun/',
  '/pacerun/index.html',
  '/pacerun/css/app.css',
  '/pacerun/js/app.js',
  '/pacerun/manifest.json',
];

// Install: pré-cache dos assets principais
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting(); // ativa imediatamente sem esperar fechar abas
});

// Activate: limpa caches de versões anteriores
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('pacerun-') && k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Removendo cache antigo:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim(); // assume controle de todas as abas imediatamente
});

// Fetch: Cache-first para assets locais, pass-through para APIs
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Não intercepta APIs externas
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('anthropic') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('nominatim') ||
    url.hostname.includes('cloudinary') ||
    url.hostname.includes('allorigins') ||
    url.hostname.includes('tile.openstreetmap')
  ) {
    return;
  }

  // Cache-first para assets locais
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Offline fallback: retorna o index.html para navegação
        if (event.request.mode === 'navigate') {
          return caches.match('/pacerun/index.html');
        }
      });
    })
  );
});

// Mensagem da página para o SW (ex: forçar atualização)
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});