// Copyright (c) 2026 ISA Spectrum
// Copyright (c) 2026 沧海四象
// Licensed under the MIT License.
const CACHE_NAME = 'isa-spectrum-v1';
const urlsToCache = ['/'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // 1. 先放行 Supabase 请求，不做任何拦截和缓存
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  // 2. 其他请求再走缓存逻辑
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});