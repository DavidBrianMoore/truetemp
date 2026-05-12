const CACHE_NAME = 'truetemp-v2'; // Bump version to force update
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force the new SW to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Network First for main files, Cache for others
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
