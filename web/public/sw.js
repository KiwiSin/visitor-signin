// Service worker: keeps the kiosk working when the network drops.
// - Pages: network first, fall back to the cached copy.
// - Built assets, icons, wallpapers, uploaded logos: cache first.
// - API calls are never cached here (the kiosk keeps its own copy of the data).
const CACHE = 'vs-shell-v1';
const SHELL = ['/', '/kiosk', '/manifest.webmanifest', '/logo-white.svg', '/logo.svg', '/icons/icon.svg',
  '/wallpapers/mountains.jpg', '/wallpapers/coast.jpg', '/wallpapers/bush.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
          caches.open(CACHE).then((c) => c.put('/kiosk', copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/kiosk'))),
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
