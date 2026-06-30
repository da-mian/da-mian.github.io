const CACHE_NAME = "g-oclock-v12";
const APP_SHELL = [
    "./",
    "./index.html",
    "./styles.css?v=12",
    "./app.js?v=12",
    "./manifest.json",
    "./icons/icon-180.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        Promise.all([
            caches.keys().then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )),
            self.clients.claim()
        ])
    );
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            const network = fetch(event.request).then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                return response;
            }).catch(() => cached);

            return cached || network;
        })
    );
});

self.addEventListener("message", event => {
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});
