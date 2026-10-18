const V = 'tenis-c9-__BUILD__';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'mkt.js', 'chat.js', 'model.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
/* Síť napřed, mezipaměť jen jako záloha offline nebo při velmi pomalé síti.
   Dřív se vracela kopie z mezipaměti a čerstvá verze se stáhla jen na pozadí, takže po pauze
   telefon ukazoval data z minulé návštěvy (třeba „data do 15. 10.“, i když server měl 18. 10.). */
const NET_MS = 6000;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (u.origin !== location.origin || req.method !== 'GET') return; // živý feed jde přímo na síť
  e.respondWith((async () => {
    const c = await caches.open(V);
    // no-cache = ověřit u serveru (ETag, většinou jen 304), nebrat 10 min starou kopii z HTTP cache
    const net = (req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' }))
      .then(r => { if (r.ok) c.put(req, r.clone()).catch(() => { }); return r; });
    net.catch(() => { });
    try {
      return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('pomalá síť')), NET_MS))]);
    } catch (err) {
      const hit = await c.match(req);
      return hit || net;
    }
  })());
});
