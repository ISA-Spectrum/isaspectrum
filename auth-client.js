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

  // ✅ 真实的 GET 探测登录（防自欺欺人）
  async function handleLogin(returnTo = location.pathname + location.search) {
    const path = `/auth/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000); // 3秒超时
      
      // 发 GET 请求，但手动拦截重定向
      const res = await fetch(path, { 
        method: 'GET', 
        redirect: 'manual', 
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);
      
      // 如果 CF 额度耗尽 (429) 或服务端报错 (5xx)
      if (res.status === 429 || res.status >= 500) {
        throw new Error("CF 额度耗尽或服务不可用");
      }
      
      // CF 存活，拿到 302 后手动执行跳转
      if (res.status >= 300 && res.status < 400) {
        const redirectUrl = res.headers.get('Location');
        if (redirectUrl) {
          window.location.href = redirectUrl;
          return;
        }
      }
      
      // 兜底直接跳转
      window.location.href = path;
    } catch (err) {
      console.warn("🚨 CF 登录接口不可用，自动切换至 Vercel 备用认证！", err);
      // 降级：因为跨域无法读取 Vercel 的 Location 头，直接让浏览器整页跳过去
      window.location.href = `${BACKUP_DOMAIN}${path}`;
    }
  }

  // ✅ 带跨域降级的 Session 获取
  async function getSession() {
    try {
      const response = await fetch('/auth/session', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      
      if (response.status === 429 || response.status >= 500) throw new Error("CF Limit");
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('session_unavailable');
      return await response.json();
    } catch (err) {
      // 🚨 主站死透，跨域去问 Vercel
      try {
        const backupRes = await fetch(`${BACKUP_DOMAIN}/auth/session`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        if (backupRes.status === 401) return null;
        return backupRes.ok ? await backupRes.json() : null;
      } catch (backupErr) {
        return null; 
      }
    }
  }

  async function requireSession(returnTo = location.pathname + location.search) {
    const session = await getSession();
    if (!session?.authenticated) {
      await handleLogin(returnTo);
      return null;
    }
    return session;
  }

  // ✅ 带容灾的注销
  async function logout(returnTo = '/main') {
    const path = `/auth/logout?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(path, { method: 'GET', redirect: 'manual', signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      
      if (res.status === 429 || res.status >= 500) throw new Error("CF Limit");
      
      const redirectUrl = res.headers.get('Location');
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      window.location.href = path;
    } catch (err) {
      console.warn("🚨 CF 注销接口不可用，切换至 Vercel 注销");
      window.location.href = `${BACKUP_DOMAIN}${path}`;
    }
  }

  window.ISAAuth = { getSession, requireSession, handleLogin, logout, safeReturnTo };
})();