// Business-site session helper. Authentication tokens never enter browser JavaScript.
(function () {
  'use strict';

  const SAFE_PAGES = new Set([
    '/main.html', '/messages.html', '/meal-rating.html', '/details.html',
    '/checker-pending.html', '/checker-approved.html', '/checker-deleted.html'
  ]);

  function safeReturnTo(value, fallback = '/main.html') {
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
    const response = await fetch('/auth/session', {
      credentials: 'same-origin',
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

  async function logout(returnTo = '/main.html') {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ returnTo: safeReturnTo(returnTo) })
    });
    if (!response.ok) throw new Error('logout_failed');
    location.replace(safeReturnTo(returnTo));
  }

  window.ISAAuth = { getSession, requireSession, loginUrl, logout, safeReturnTo };
})();
