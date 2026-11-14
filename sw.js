// Cache offline dell'app. Aumenta VERSION a ogni rilascio per aggiornare i file sull'iPhone.
const VERSION = 'v1.0.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/parse.js', './js/muscles.js', './js/stats.js', './js/data.js', './js/gcal.js', './js/pdf.js',
  './vendor/chart.umd.js', './vendor/jspdf.umd.min.js', './vendor/jspdf.plugin.autotable.min.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google API: sempre rete
  // rete prima (così gli aggiornamenti arrivano), cache se offline
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
