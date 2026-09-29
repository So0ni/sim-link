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

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || typeof payload.body !== 'string' || typeof payload.sessionId !== 'string') return;
    // Check the live session before exposing a sender on a shared/logged-out device.
    let verified = false;
    try {
      const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.status === 401) return;
      if (response.ok) {
        const session = await response.json();
        if (session.id !== payload.sessionId) return;
        verified = true;
      }
    } catch { /* Offline fallback contains no sender or private deep link. */ }
    await self.registration.showNotification('SIMLink', {
      body: verified ? payload.body : '打开 SIMLink 查看新通知',
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag : 'simlink',
      data: { url: verified ? payload.url : '/#/inbox' },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    let target;
    try { target = new URL(event.notification.data?.url || '/#/inbox', self.location.origin); } catch { return; }
    if (target.origin !== self.location.origin || target.pathname !== '/' || !/^#\/(inbox(?:\/.*)?|settings)$/.test(target.hash)) return;
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href); await client.focus(); return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
