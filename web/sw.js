const V = 'tenis-c6-__BUILD__';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'mkt.js', 'chat.js', 'model.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // živý feed jde přímo na síť
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit && u.pathname.includes('/data/st/') ? hit : (hit ? (net.catch(() => { }), hit) : net);
  }));
});
