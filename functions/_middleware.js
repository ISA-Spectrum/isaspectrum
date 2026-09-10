const encoder = new TextEncoder();

function parseCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function validInnerCookie(request, secret) {
  const cookie = parseCookie(request, 'inner_verify');
  if (!cookie) return false;
  const [expires, signature] = cookie.split('.');
  if (!/^\d{10,13}$/.test(expires || '') || !signature || Number(expires) <= Date.now()) return false;
  const expected = await sign(expires, secret);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function page(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html;charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    }
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // OAuth/OIDC callbacks and server endpoints must reach their Pages Functions.
  if (path.startsWith('/auth/') || path.startsWith('/api/')) return next();

  const staticSuffix = [
    '.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif',
    '.css', '.js', '.mjs', '.woff', '.woff2', '.ttf', '.otf',
    '.ico', '.map'
  ];
  const isStatic = staticSuffix.some(suffix => path.endsWith(suffix));
  if (isStatic || path === '/favicon.ico') return env.ASSETS.fetch(request);

  if (!url.hostname.includes('test')) return next();

  const password = env.INNER_TEST_PASSWORD;
  if (!password) return page('Missing INNER_TEST_PASSWORD environment variable', 500);

  if (await validInnerCookie(request, password)) return next();

  if (request.method === 'POST' && path === '/_check_pass') {
    let submitted = '';
    try { submitted = String((await request.formData()).get('pwd') || ''); } catch {}
    if (submitted === password) {
      const expires = String(Date.now() + 86400 * 1000);
      const signature = await sign(expires, password);
      const secure = url.protocol === 'https:' ? '; Secure' : '';
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Cache-Control': 'no-store',
          'Set-Cookie': `inner_verify=${expires}.${signature}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`
        }
      });
    }
    return page(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>验证失败 | ISA Spectrum</title><style>*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:20px;place-items:center;color:#171c2c;background:#f4f6fb;font-family:system-ui,sans-serif}.card{width:min(400px,100%);padding:36px;border:1px solid #dfe4ee;border-radius:20px;text-align:center;background:#fff;box-shadow:0 18px 50px rgba(16,35,126,.1)}h1{margin:0 0 12px;font-size:26px}p{margin:0 0 24px;color:#68728b}.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:0 18px;border-radius:12px;color:#fff;background:#2146f3;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>密码验证失败</h1><p>请返回并重新输入内测访问密码。</p><a class="button" href="/">返回验证页面</a></main></body></html>`, 403);
  }

  return page(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>内测访问验证 | ISA Spectrum</title><style>*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:20px;place-items:center;color:#171c2c;background:#f4f6fb;font-family:system-ui,sans-serif}.card{width:min(420px,100%);padding:38px;border:1px solid #dfe4ee;border-radius:22px;background:#fff;box-shadow:0 18px 50px rgba(16,35,126,.1)}.mark{display:grid;width:52px;height:52px;margin-bottom:24px;place-items:center;border-radius:16px;color:#c9ff47;background:#101b44;font-weight:850}h1{margin:0 0 8px;font-size:30px;letter-spacing:-.04em}p{margin:0 0 26px;color:#68728b}.input{width:100%;min-height:48px;padding:0 14px;border:1px solid #d5dae6;border-radius:12px;font-size:16px}.input:focus{outline:0;border-color:#2146f3;box-shadow:0 0 0 4px rgba(33,70,243,.1)}.button{width:100%;min-height:48px;margin-top:12px;border:0;border-radius:12px;color:#fff;background:#2146f3;cursor:pointer;font-size:16px;font-weight:750}</style></head><body><main class="card"><div class="mark">IS</div><h1>ISA Spectrum 内测</h1><p>请输入访问密码继续浏览测试网站。</p><form method="POST" action="/_check_pass"><input class="input" name="pwd" type="password" placeholder="请输入内测访问密码" required autocomplete="current-password"><button class="button" type="submit">进入内测站点</button></form></main></body></html>`);
}
