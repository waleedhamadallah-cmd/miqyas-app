const CACHE_NAME = 'miqyas-cache-v6';
const SHELL = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './css/styles.css',
  './js/core.js', './js/home.js', './js/food.js', './js/ai.js',
  './js/progress.js', './js/reminders.js', './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for our own files, so any edit you publish shows up the
// next time the app opens (with internet). cache: 'no-store' makes sure we
// bypass the browser's own HTTP disk cache too, not just our Cache API
// storage, so edits show up immediately instead of waiting out a cache
// lifetime. Falls back to the last cached copy when there's no connection,
// so the app still opens offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // leave fonts/Firebase/etc. alone

  const freshRequest = new Request(e.request.url, {
    method: 'GET',
    headers: e.request.headers,
    mode: 'same-origin',
    credentials: 'same-origin',
    cache: 'no-store'
  });

  e.respondWith(
    fetch(freshRequest)
      .then((res) => {
        // fetch() only REJECTS on a network-level failure — an HTTP error
        // status (404/500/503/a mid-deploy hiccup on GitHub Pages) still
        // resolves normally. Without this res.ok check, that error response
        // would get cached over the last good copy of a core file, and then
        // get served forever on every future offline load until the next
        // successful online fetch — the opposite of the "falls back to the
        // last cached copy" behavior this is supposed to give you.
        if (res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
  );
});
