// Service Worker for PWA functionality
const CACHE_NAME = 'operation-unter-dem-sitz-v3';
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/main.js',
    './manifest.json',
    './images/icon-192x192.png',
    './images/icon-512x512.png'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const networkFetch = fetch(event.request)
                .then(networkResponse => {
                    // Update cache with the latest version.
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            // Prefer cache for instant load, but always revalidate in the background.
            return cachedResponse || networkFetch;
        })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        Promise.all([
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheWhitelist.indexOf(cacheName) === -1) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            self.clients.claim()
        ])
    );
});
