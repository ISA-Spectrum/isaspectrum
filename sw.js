const CACHE_NAME = 'isa-spectrum-v1';
const urlsToCache = ['/'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});
// 放行 Supabase 请求，不做拦截
if (event.request.url.includes('supabase.co')) {
    return fetch(event.request);
}
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});