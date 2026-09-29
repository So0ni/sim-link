/* Build replaces these constants. Only immutable build assets and the public shell are cached. */
const CACHE = "simlink-shell-__BUILD_ID__";
const ASSETS = __PRECACHE__;
const allowed = new Set(ASSETS);
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS.map(path => new Request(path, { credentials: "omit", cache: "reload" })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // An update waits until the user accepts it or all old tabs are closed.
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("simlink-shell-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // API, credentials, query strings, writes and other origins never enter Cache Storage.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search) return;
  const shell = request.mode === "navigate" && ["/", "/index.html"].includes(url.pathname);
  const path = shell ? "/index.html" : url.pathname;
  if (!allowed.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Do not runtime-cache responses. The installation list is the only writer.
    return (await cache.match(path)) || fetch(request);
  })());
});
