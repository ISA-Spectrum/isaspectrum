// Business-site session helper. Authentication tokens never enter browser JavaScript.
(function () {
  'use strict';

  const SAFE_PAGES = new Set([
    '/main', '/messages', '/meal-rating', '/details',
    '/checker-pending', '/checker-approved', '/checker-deleted'
  ]);

  const PRIMARY_DOMAIN = 'https://isaspectrum.celestivast.com';
  const BACKUP_DOMAIN = 'https://api.celestivast.com'; // 你的 Vercel 备用站

  // ✅ 修复 1：自动剥离 .html 后缀的终极清洗器
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

  // ✅ 修复 2：带容灾探测的登录触发器
  async function handleLogin(returnTo = location.pathname + location.search) {
    const path = `/auth/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
    try {
      // 发一个 HEAD 请求探测主站存活状态（超快，不消耗页面渲染）
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000); // 2秒超时
      const res = await fetch(path, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      
      // 如果 CF 额度耗尽 (429) 或服务端报错 (5xx)
      if (res.status === 429 || res.status >= 500) throw new Error("CF Limit");
      
      // 主站存活，走主站
      window.location.href = path;
    } catch (err) {
      console.warn("🚨 CF 登录接口不可用，自动切换至 Vercel 备用认证！", err);
      // 主站挂了，强制去 Vercel 登录
      window.location.href = `${BACKUP_DOMAIN}${path}`;
    }
  }

  // ✅ 修复 3：带跨域降级的 Session 获取
  async function getSession() {
    try {
      const response = await fetch('/auth/session', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      
      // 如果 CF 挂了（额度耗尽或宕机），抛出异常进入 catch
      if (response.status === 429 || response.status >= 500) throw new Error("CF Limit");
      
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('session_unavailable');
      return await response.json();
    } catch (err) {
      // 🚨 主站死透，跨域去问 Vercel（Cookie 已经在 .celestivast.com 根域下，完美携带）
      try {
        const backupRes = await fetch(`${BACKUP_DOMAIN}/auth/session`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        if (backupRes.status === 401) return null;
        return backupRes.ok ? await backupRes.json() : null;
      } catch (backupErr) {
        return null; // 两边都挂了，当作未登录
      }
    }
  }

  async function requireSession(returnTo = location.pathname + location.search) {
    const session = await getSession();
    if (!session?.authenticated) {
      // 使用带容灾的 handleLogin，而不是直接改 location.href
      await handleLogin(returnTo);
      return null;
    }
    return session;
  }

  // ✅ 修复 4：带容灾的注销
  async function logout(returnTo = '/main') {
    const path = `/auth/logout?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(path, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      
      if (res.status === 429 || res.status >= 500) throw new Error("CF Limit");
      window.location.href = path;
    } catch (err) {
      console.warn("🚨 CF 注销接口不可用，切换至 Vercel 注销");
      window.location.href = `${BACKUP_DOMAIN}${path}`;
    }
  }

  window.ISAAuth = { getSession, requireSession, handleLogin, logout, safeReturnTo };
})();