// Business-site session helper. Authentication tokens never enter browser JavaScript.
(function () {
  'use strict';

  const SAFE_PAGES = new Set([
    '/main', '/messages', '/meal-rating', '/details',
    '/checker-pending', '/checker-approved', '/checker-deleted'
  ]);

  const BACKUP_DOMAIN = 'https://api.celestivast.com'; // 你的 Vercel 备用站域名

  // ✅ 自动剥离 .html 后缀的终极清洗器
  function safeReturnTo(value, fallback = '/main') {
    try {
      const candidate = value?.startsWith('/') ? value : `/${value || ''}`;
      const url = new URL(candidate, location.origin);
      let cleanPath = url.pathname.replace(/\.html$/, '');
      if (cleanPath === '') cleanPath = '/';

      return url.origin === location.origin && SAFE_PAGES.has(cleanPath)
        ? `${cleanPath}${url.search}${url.hash}`
        : fallback;
    } catch {
      return fallback;
    }
  }

  // Probe a side-effect-free endpoint; fetching login/logout would create or
  // revoke sessions twice, and manual redirects are opaque in browsers.
  async function authOrigin() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('/auth/session', { credentials: 'include', cache: 'no-store', signal: controller.signal });
      return res.status === 429 || res.status >= 500 ? BACKUP_DOMAIN : '';
    } catch { return BACKUP_DOMAIN; }
    finally { clearTimeout(timer); }
  }
  async function handleLogin(returnTo = location.pathname + location.search) {
    const origin = await authOrigin();
    window.location.href = `${origin}/auth/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
  }
  async function getSession() {
    const response = await window.request('/auth/session', {
      headers: { Accept: 'application/json' }, cache: 'no-store'
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('session_unavailable');
    return response.json();
  }

  async function requireSession(returnTo = location.pathname + location.search) {
    const session = await getSession();
    if (!session?.authenticated) {
      await handleLogin(returnTo);
      return null;
    }
    return session;
  }

  async function logout(returnTo = '/main') {
    try {
      const origin = await authOrigin();
      const response = await fetch(`${origin}/auth/logout`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ returnTo: safeReturnTo(returnTo) })
      });
      if (!response.ok) throw new Error('logout_failed');
      const result = await response.json();
      location.href = result.idpLogoutUrl || safeReturnTo(result.returnTo);
    } catch {
      alert('退出失败，请稍后重试');
    }
  }

  window.ISAAuth = { getSession, requireSession, handleLogin, logout, safeReturnTo };
})();