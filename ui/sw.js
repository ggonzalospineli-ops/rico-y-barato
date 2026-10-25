// Service worker: la app abre sin internet con el último catálogo guardado.
// - App (html, js, css, íconos): red primero, sin la caché HTTP del navegador; si no hay red, lo guardado.
//   (Antes era caché primero y la tablet seguía mostrando la versión vieja después de publicar.)
// - Catálogo: red primero (para tener precios nuevos); si no hay red, el guardado.
// - Fotos de Rappi: caché a medida que se ven (con tope), para que el modo sin internet no quede vacío.
// Subir VERSION al cambiar la lista SHELL.

const VERSION = 'ryb-v4';
const SHELL = [
  './', './index.html', './app.js', './ai.js', './assistant.js', './styles.css', './features.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  '../engine/engine.js', '../engine/planner.js', '../engine/scoring.js', '../engine/taste.js', '../engine/hours.js',
  '../engine/split.js', '../engine/intent.js', '../engine/voice.js', '../engine/shuffle.js', '../sources/demo.js', '../sources/json.js', '../data/catalog.js',
];
const CATALOG = '../data/rappi-catalog.json';
const MAX_IMAGES = 400;

self.addEventListener('install', e => {
  // cache: 'reload' evita que GitHub Pages (max-age=600) devuelva archivos de hace 10 minutos.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('ryb-') && k !== VERSION && k !== 'ryb-img').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.href === new URL(CATALOG, self.registration.scope).href) {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }

  if (url.hostname === 'images.rappi.com.ar') {
    e.respondWith(caches.open('ryb-img').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') {
        await c.put(e.request, res.clone());
        c.keys().then(keys => keys.slice(0, Math.max(0, keys.length - MAX_IMAGES)).forEach(k => c.delete(k)));
      }
      return res;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
  }
});

// Tocar un aviso abre la app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list[0] ? list[0].focus() : self.clients.openWindow('./')));
});
