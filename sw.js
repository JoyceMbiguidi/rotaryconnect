/* RotaryConnect – service worker : coquille de l'app en cache, API toujours via le réseau. */
const VERSION = 'rc-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/config.js',
  'js/api.js',
  'js/ui.js',
  'js/app.js',
  'js/gas-shim.js',
  'js/demo-seed.js',
  'apps-script/Code.gs',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/login-bg.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // La configuration (URL de l'API) doit toujours être à jour : réseau d'abord.
  if (url.pathname.endsWith('/js/config.js')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  // Stale-while-revalidate : réponse immédiate depuis le cache, mise à jour en arrière-plan.
  event.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        const network = fetch(req)
          .then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
        return cached || network;
      })
    )
  );
});
