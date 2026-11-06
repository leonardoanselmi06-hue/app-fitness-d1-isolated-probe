// Service worker: mette in cache SOLO la shell statica. Le API (/v1/*) non vengono mai memorizzate (dati sanitari).
const CACHE = 'app-fitness-shell-v9';
const SHELL = ['/', '/styles.css', '/views.css', '/app.js', '/views.js', '/views-daily.js', '/coach.js', '/plan.js', '/plan-forms.js', '/plan-ui.js', '/plan-report.js', '/plan-adherence.js', '/checkin.js', '/plan.css', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/v1/')) return; // rete diretta, niente cache
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
