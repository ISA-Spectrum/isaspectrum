// Business-site session helper. Authentication tokens never enter browser JavaScript.
(function () {
  'use strict';

  // ✅ 修复 1：去掉所有的 .html
  const SAFE_PAGES = new Set([
    '/main', '/messages', '/meal-rating', '/details',
    '/checker-pending', '/checker-approved', '/checker-deleted'
  ]);

  // ✅ 修复 2：默认 fallback 也去掉 .html
  function safeReturnTo(value, fallback = '/main') {
    try {
      const candidate = value?.startsWith('/') ? value : `/${value || ''}`;
      const url = new URL(candidate, location.origin);
      return url.origin === location.origin && SAFE_PAGES.has(url.pathname)
        ? `${url.pathname}${url.search}${url.hash}`
        : fallback;
    } catch {
      return fallback;
    }
  }

  function loginUrl(returnTo = location.pathname + location.search) {
    return `/auth/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
  }

  async function getSession() {
    // ✅ 修复 3：换回原生 fetch，防止超时跨域导致 Cookie 丢失
    const response = await fetch('/auth/session', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('session_unavailable');
    return response.json();
  }

  async function requireSession(returnTo = location.pathname + location.search) {
    const session = await getSession();
    if (!session?.authenticated) {
      location.replace(loginUrl(returnTo));
      return null;
    }
    return session;
  }

  // ✅ 修复 4：让注销也带上 return_to
  async function logout(returnTo = '/main') {
    location.href = `/auth/logout?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
  }

  window.ISAAuth = { getSession, requireSession, loginUrl, logout, safeReturnTo };
})();