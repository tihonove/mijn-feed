// Service worker: app shell offline, hashed assets cache-first, media cache-first,
// the feed network-first with the last good copy as a fallback. Events are never cached (the app queues them).
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const MEDIA = `media-${VERSION}`;
const FEED = `feed-${VERSION}`;

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => ![SHELL, MEDIA, FEED].includes(k)).map((k) => caches.delete(k))),
            ),
    );
    self.clients.claim();
});

const networkFirst = async (request, cacheName) => {
    const cache = await caches.open(cacheName);
    try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw new Error("offline");
    }
};

const cacheFirst = async (request, cacheName) => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
};

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/v1/feed/")) return;
    if (url.pathname === "/v1/feed") return event.respondWith(networkFirst(request, FEED));
    if (url.pathname.startsWith("/v1/")) return;
    if (url.pathname.startsWith("/media/")) return event.respondWith(cacheFirst(request, MEDIA));
    if (url.pathname.startsWith("/assets/")) return event.respondWith(cacheFirst(request, SHELL));
    if (request.mode === "navigate") {
        return event.respondWith(networkFirst(new Request("/", { credentials: "include" }), SHELL));
    }
    event.respondWith(networkFirst(request, SHELL));
});
