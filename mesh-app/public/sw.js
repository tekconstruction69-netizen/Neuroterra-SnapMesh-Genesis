'use strict';
/* Service worker minimal : cache statique, pas de calcul en arrière-plan. */
const CACHE = 'snapmesh-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // jamais de cache sur l'état
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
