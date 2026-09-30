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
let notificationEpoch = 0;
self.addEventListener("message", event => {
  if (event.data?.type === 'CLEAR_BADGE') {
    notificationEpoch++;
    event.waitUntil(setBadge(0));
  }
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

// Keep live-session validation short; slow/offline verification yields a private notification.
async function boundedJson(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(path, {credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
    return {status:response.status,ok:response.ok,value:response.ok ? await response.json() : null};
  } finally { clearTimeout(timer); }
}
let badgeWrites = Promise.resolve();
function setBadge(count) {
  if (!Number.isSafeInteger(count) || count < 0 || !self.navigator) return Promise.resolve();
  badgeWrites = badgeWrites.then(async () => {
    if (count === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
    else if (self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
  }).catch(() => {}); // A later logout clear follows any in-flight OS write.
  return badgeWrites;
}
self.addEventListener('push', event => {
  const receivedAt = Date.now(), epoch = notificationEpoch;
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || typeof payload.body !== 'string' || typeof payload.sessionId !== 'string') return;
    let verified = false, session;
    try {
      let result = await boundedJson('/api/v1/messages/summary');
      // A newer worker remains compatible with the preceding server release.
      if (result.status === 404) result = await boundedJson('/api/v1/auth/session');
      if (epoch !== notificationEpoch) return;
      if (result.status === 401) { await setBadge(0); return; }
      if (result.ok) {
        session = result.value;
        if ((session.sessionId ?? session.id) !== payload.sessionId) return;
        verified = true;
      }
    } catch { /* No sender, private link or guessed unread count while offline. */ }
    if (epoch !== notificationEpoch) return;
    const report = async shownAt => {
      if (!verified || typeof payload.jobId !== 'string' || typeof session?.csrfToken !== 'string') return;
      try { await boundedJson('/api/v1/push/jobs/'+encodeURIComponent(payload.jobId)+'/receipt', {
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},
        body:JSON.stringify({receivedAt,shownAt}),
      }); } catch { /* Diagnostic reporting must never delay display or force another notification. */ }
    };
    const receivedReport = report(null);
    const badge = verified ? setBadge(session.unreadCount) : Promise.resolve();
    try {
      await self.registration.showNotification(verified ? payload.body : '新通知', {
        ...(verified ? (typeof payload.preview === 'string' ? {body:payload.preview} : {}) : {body:'打开 SIMLink 查看新通知'}),
        icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',
        tag:typeof payload.tag === 'string' ? payload.tag : 'simlink',
        data:{url:verified ? payload.url : '/#/inbox'},
      });
      await report(Date.now());
    } finally { await Promise.allSettled([receivedReport,badge]); }
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
