// TrailLink service worker: makes the app open with no signal, and serves saved map tiles offline.
const APP_CACHE = 'traillink-app-v5';
const TILE_CACHE = 'traillink-tiles-v1'; // same name as src/offline.ts
const RUNTIME_TILE_LIMIT = 3000; // tiles kept from normal browsing (saved areas are not trimmed)

const TILE_HOSTS = ['basemap.nationalmap.gov', 'apps.fs.usda.gov'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Same rule as offline.ts: round MVUM bbox numbers so cache keys match.
function cacheKey(url) {
  if (!url.includes('EDW_MVUM')) return url;
  return url.replace(/bbox=([^&]+)/, (_m, b) => 'bbox=' + decodeURIComponent(b).split(',').map(v => Math.round(Number(v))).join(','));
}

self.addEventListener('install', event => {
  const scope = self.registration.scope;
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll([scope, `${scope}manifest.webmanifest`, `${scope}icon-192.png`]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('traillink-app-') && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles (including our own trail tiles): saved or recently seen copy first, then the network (and keep a copy).
  const ownTrailTile = url.origin === self.location.origin && /\/trails\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname);
  if (TILE_HOSTS.includes(url.hostname) || ownTrailTile) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const key = cacheKey(req.url);
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { cache.put(key, res.clone()); trim(cache); }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline and not saved' });
      }
    })());
    return;
  }

  // Fonts: cache first.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(APP_CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }

  // The app itself (same origin): network first so updates arrive, cached copy when offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match(self.registration.scope) : undefined) || Response.error();
      }
    })());
  }
});

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    // Only trims when far over the limit; saved areas are usually well under it per area.
    if (keys.length > RUNTIME_TILE_LIMIT * 4) for (const k of keys.slice(0, keys.length - RUNTIME_TILE_LIMIT * 4)) await cache.delete(k);
  } finally { trimming = false; }
}

// Group message notifications (sent by the "push" function when the app is closed or in the background).
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'TrailLink', {
    body: d.body || 'New message', tag: d.tag, renotify: true, requireInteraction: !!d.urgent, vibrate: d.urgent ? [300, 120, 300, 120, 600] : undefined,
    icon: `${self.registration.scope}icon-192.png`, badge: `${self.registration.scope}icon-192.png`,
    data: { url: new URL(d.url || './#group', self.registration.scope).href },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); try { await w.navigate(url); } catch { /* same page */ } return; } }
    await self.clients.openWindow(url);
  })());
});
