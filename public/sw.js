// Minimal offline cache for the built game. Registered only in production builds (src/ui/pwa.ts).
// - Built assets (/assets/*, hashed names, so they never change) and the icons: cache-first.
// - Documents (index.html and navigations): network-first, falling back to the cached shell when offline.
// Bump CACHE when the shell changes shape; old caches are deleted on activate.
// Every path is relative to the worker's scope, so the game works at a domain root and in a sub-folder (GitHub Pages).
const CACHE = 'loose-money-v2';
const BASE = new URL(self.registration.scope).pathname; // "/" or "/llm-lets-loose-money/"
const INDEX = BASE + 'index.html';
const SHELL = [BASE, INDEX, BASE + 'manifest.webmanifest', BASE + 'icon-192.png', BASE + 'icon-512.png', BASE + 'apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One failing URL should not stop the install.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isDocument(request, url) {
  return request.mode === 'navigate' || url.pathname === BASE || url.pathname.endsWith('.html');
}

function isStaticAsset(url) {
  return url.pathname.startsWith(BASE + 'assets/') || SHELL.includes(url.pathname) || /\.(png|webmanifest)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Fonts and the relay are other origins: leave them to the network.
  if (url.origin !== self.location.origin) return;

  if (isDocument(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(INDEX, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match(INDEX))),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
