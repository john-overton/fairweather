/* Fairweather service worker. Served at /fairweather/sw.js, scope /fairweather
   - App shell: network-first navigation with cached fallback
   - Next static assets (incl. self-hosted fonts): cache-first (immutable)
   - Forecast API: network-first, last response per location kept for offline
   - Web Push: show, click-through, and subscription rotation */
const BASE = '/fairweather';
const VERSION = 'fw-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const DATA = `${VERSION}-data`;
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll([BASE, `${BASE}/manifest.webmanifest`, `${BASE}/icons/icon-192.png`]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fw-') && !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(cacheKey || req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(cacheKey || req);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || DEV) return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    event.respondWith(networkFirst(req, SHELL, BASE));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith(`${BASE}/_next/static/`)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin === self.location.origin && url.pathname === `${BASE}/api/forecast`) {
    event.respondWith(networkFirst(req, DATA));
  }
});

/* ---------------- Push ---------------- */

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { title: 'Fairweather', body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(p.title || 'Fairweather', {
      body: p.body || '',
      tag: p.tag,
      renotify: !!p.tag,
      icon: `${BASE}/icons/icon-192.png`,
      badge: `${BASE}/icons/badge-96.png`,
      data: { url: p.url || `${BASE}#now` },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || `${BASE}#now`, self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname.startsWith(BASE) && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription && event.oldSubscription.toJSON();
    let sub = event.newSubscription;
    if (!sub) {
      const r = await fetch(`${BASE}/api/push/vapid-key`);
      const { key } = await r.json();
      const pad = '='.repeat((4 - (key.length % 4)) % 4);
      const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    }
    if (!old || !old.keys) return; // the app re-registers on next open
    await fetch(`${BASE}/api/push/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${old.keys.auth}` },
      body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: sub.toJSON() }),
    });
  })());
});
