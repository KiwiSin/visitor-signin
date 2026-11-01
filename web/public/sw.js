// Service worker: keeps the kiosk working when the network drops.
// - Pages: network first, fall back to the cached copy.
// - Built assets, icons, wallpapers, uploaded logos: cache first.
// - API calls are never cached here (the kiosk keeps its own copy of the data).
const CACHE = 'vs-shell-v2';
const SHELL = ['/', '/kiosk', '/rollcall', '/manifest-rollcall.webmanifest', '/icons/rollcall-192.png', '/manifest.webmanifest', '/logo-white.svg', '/logo.svg', '/icons/icon.svg',
  '/wallpapers/mountains.jpg', '/wallpapers/coast.jpg', '/wallpapers/bush.jpg'];

// Cache the page plus every script, stylesheet and font it uses, so the app opens with no connection.
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const html = await (await fetch('/kiosk', { cache: 'no-store' })).text();
  const assets = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]));
  for (const css of [...assets].filter((a) => a.endsWith('.css'))) {
    const text = await (await fetch(css)).text();
    for (const m of text.matchAll(/url\((\/assets\/[^)]+\.woff2)\)/g)) assets.add(m[1]);
  }
  await cache.addAll([...assets]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          return res;
        })
        // Offline: the cached copy of this page, or any copy of the app (it is one page that routes itself).
        .catch(async () => {
          for (const path of [url.pathname, '/rollcall', '/kiosk', '/']) {
            const hit = await caches.match(path);
            if (hit) return hit;
          }
          return Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/uploads/') ||
          url.pathname.startsWith('/wallpapers/') || url.pathname.startsWith('/icons/'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
