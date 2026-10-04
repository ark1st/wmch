// Scoped to the event only. Bump VERSION when changing any event asset or page.
const VERSION = 'wmch-draw-47-v3';
const ROOT = new URL('./', self.location).pathname;
const CACHE = `${VERSION}-${ROOT}`;
const FILES = ['', 'control/', 'stage/', 'app.css', 'core.mjs', 'store.mjs', 'stage.mjs', 'control.mjs', 'audio.mjs', 'logo.png', 'church-exterior.jpg'].map(path => ROOT + path);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  // Keep an active event on its installed version until all its windows close.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wmch-draw-47-') && k.endsWith(`-${ROOT}`) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(ROOT)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const pathname = url.pathname === ROOT.slice(0, -1) ? ROOT : url.pathname;
    const cached = await cache.match(pathname, {ignoreSearch:true});
    return cached ?? fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'VERIFY_CACHE') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let available = await Promise.all(FILES.map(path => cache.match(path)));
    if (available.some(value => !value)) {
      try { await cache.addAll(FILES); } catch { /* Keep a truthful not-ready status offline. */ }
      available = await Promise.all(FILES.map(path => cache.match(path)));
    }
    event.ports[0]?.postMessage({ready:available.every(Boolean)});
  })());
});
