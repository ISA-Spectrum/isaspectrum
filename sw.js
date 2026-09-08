// Copyright (c) 2026 ISA Spectrum
// Copyright (c) 2026 沧海四象
// Licensed under the MIT License.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清掉SW全部CacheStorage缓存
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    // 注销自己
    await self.registration.unregister();
    // 【重点】注释掉下面，不要自动刷新，防止丢表单
    // const clients = await self.clients.matchAll();
    // clients.forEach((c) => c.navigate(c.url));
  })());
});
