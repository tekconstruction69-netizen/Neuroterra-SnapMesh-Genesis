'use strict';
/* Service worker : cache versionné des seules ressources publiques
   statiques (styles, script applicatif sans jeton, manifeste).
   Jamais de HTML (il peut contenir le jeton local en mode local),
   jamais d'API. Aucun mode hors-ligne ni installation n'est promis :
   la navigation n'est pas mise en cache. */
const CACHE = 'snapmesh-public-v3';
const ASSETS = ['/styles.css', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('snapmesh-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // jamais de cache sur l'état
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) return; // HTML : réseau seul
  if (!ASSETS.includes(url.pathname)) return; // le reste : réseau seul
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
