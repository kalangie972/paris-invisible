// Paris Invisible — Service Worker v1.13
// Network-first pour la page (garantit les mises à jour), cache-first pour les assets,
// network-first pour les tuiles de carte.
// ⚠️ Bumper CACHE à chaque déploiement modifiant index.html.
const CACHE = 'paris-invisible-v13';
const ASSETS = [
  './',
  './index.html',
  './core.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Page principale : network-first → les mises à jour arrivent aux utilisateurs,
  // avec fallback cache pour l'offline
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', clone));
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }
  // Tuiles de carte : network-first avec fallback cache (limite la taille du cache)
  if (url.hostname.includes('basemaps.cartocdn.com')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE + '-tiles').then(c => {
          c.put(e.request, clone);
          // Purge simple : garder le cache de tuiles raisonnable
          c.keys().then(keys => { if (keys.length > 200) c.delete(keys[0]); });
        });
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Tout le reste : cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (e.request.method === 'GET' && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
