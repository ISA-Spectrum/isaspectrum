import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { sameOriginRequest } from '../functions/_lib/http.js';
import { createTransaction, readSession } from '../functions/_lib/store-supabase.js';
const source = await readFile(new URL('../request.js', import.meta.url), 'utf8');
function client(fetch) {
  const window = {};
  vm.runInNewContext(source, { window, location: { origin: 'https://isaspectrum.celestivast.com' }, fetch, AbortController, DOMException, setTimeout, clearTimeout });
  return window.request;
}
test('a route error falls back for that read but the next request tries Cloudflare', async () => {
  const urls = [];
  const request = client(async url => { urls.push(url); return new Response('', { status: urls.length === 1 ? 503 : 200 }); });
  await request('/api/messages');
  await request('/api/profile');
  assert.deepEqual(urls, ['https://isaspectrum.celestivast.com/api/messages', 'https://api.celestivast.com/api/messages', 'https://isaspectrum.celestivast.com/api/profile']);
});
test('quota exhaustion switches subsequent requests and includes cookies', async () => {
  const calls = [];
  const request = client(async (url, init) => { calls.push({ url, init }); return new Response('', { status: calls.length === 1 ? 429 : 200 }); });
  await request('/api/messages');
  await request('/api/profile');
  assert.equal(calls[2].url, 'https://api.celestivast.com/api/profile');
  assert.equal(calls[2].init.credentials, 'include');
});
test('ambiguous writes are never replayed on the backup', async () => {
  let calls = 0;
  const request = client(async () => { calls++; throw new TypeError('lost response after commit'); });
  await assert.rejects(request('/api/messages', { method: 'post', body: '{}' }));
  assert.equal(calls, 1);
});
test('caller cancellation does not send a backup request', async () => {
  let calls = 0;
  const controller = new AbortController();
  const request = client(async (_, init) => {
    calls++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  });
  const pending = request('/api/messages', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(calls, 1);
});
test('only the exact frontend origin can write to the backup cross-origin', () => {
  const request = origin => new Request('https://api.celestivast.com/api/messages', { method: 'POST', headers: { Origin: origin } });
  assert.equal(sameOriginRequest(request('https://isaspectrum.celestivast.com')), true);
  assert.equal(sameOriginRequest(request('https://evil.celestivast.com')), false);
  assert.equal(sameOriginRequest(request('https://isaspectrum.celestivast.com.evil.test')), false);
});
test('shared store uses a server-only RPC credential and preserves typed sessions', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const env = { BUSINESS_SUPABASE_URL: 'https://db.example', AUTH_STORE_SUPABASE_SECRET_KEY: 'sb_secret_test' };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://db.example/rest/v1/rpc/isa_auth_store');
    assert.equal(init.headers.apikey, 'sb_secret_test');
    const { operation, args } = JSON.parse(init.body);
    assert.equal(operation, 'read_session');
    assert.equal(args.hash, 'hashed-token');
    return Response.json({ is_checker: true, amr: ['pwd'] });
  };
  assert.deepEqual(await readSession(env, 'hashed-token'), { is_checker: true, amr: ['pwd'] });
  await assert.rejects(createTransaction({ BUSINESS_SUPABASE_URL: 'https://db.example' }, {}), /auth_store_not_configured/);
});
const authSource = await readFile(new URL('../auth-client.js', import.meta.url), 'utf8');
test('login probes session once, then navigates without fetching a redirect', async () => {
  const calls = [];
  const location = { origin: 'https://isaspectrum.celestivast.com', pathname: '/main', search: '' };
  const window = { location };
  vm.runInNewContext(authSource, { window, location, URL, AbortController, setTimeout, clearTimeout, fetch: async url => {
    calls.push(url);
    return new Response('{}', { status: 401 });
  }});
  await window.ISAAuth.handleLogin('/messages.html');
  assert.deepEqual(calls, ['/auth/session']);
  assert.equal(location.href, '/auth/login?return_to=%2Fmessages');
});

test('logout uses the backup with cookies after a failed probe and navigates only on success', async () => {
  const calls = [];
  const location = { origin: 'https://isaspectrum.celestivast.com', href: '/messages' };
  const window = { location };
  vm.runInNewContext(authSource, { window, location, URL, AbortController, setTimeout, clearTimeout,
    alert: () => assert.fail('logout should succeed'),
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === '/auth/session') return new Response('', { status: 503 });
      assert.equal(location.href, '/messages');
      return Response.json({ returnTo: '/main' });
    }
  });
  await window.ISAAuth.logout('/main.html');
  assert.deepEqual(calls.map(call => call.url), ['/auth/session', 'https://api.celestivast.com/auth/logout']);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.credentials, 'include');
  assert.equal(JSON.parse(calls[1].init.body).returnTo, '/main');
  assert.equal(location.href, '/main');
});

test('logout failure stays on the page and never replays the write', async () => {
  const calls = [];
  const location = { origin: 'https://isaspectrum.celestivast.com', href: '/messages' };
  const window = { location };
  let alerts = 0;
  vm.runInNewContext(authSource, { window, location, URL, AbortController, setTimeout, clearTimeout,
    alert: () => { alerts++; },
    fetch: async url => {
      calls.push(url);
      return new Response('{}', { status: url === '/auth/session' ? 200 : 503 });
    }
  });
  await window.ISAAuth.logout();
  assert.deepEqual(calls, ['/auth/session', '/auth/logout']);
  assert.equal(location.href, '/messages');
  assert.equal(alerts, 1);
});


test('logout is single flight and follows only a valid opaque path', async () => {
  const location = { origin: 'https://isaspectrum.celestivast.com', href: '/messages' };
  const window = {}; let writes = 0;
  vm.runInNewContext(authSource, { window, location, URL, AbortController, setTimeout, clearTimeout, alert: () => assert.fail(),
    fetch: async (url, init) => {
      if (url === '/auth/session') return new Response('{}');
      writes++; assert.ok(init.signal);
      return Response.json({ logoutPath: '/auth/logout?ticket=' + 'a'.repeat(43), returnTo: '/main' });
    }
  });
  const first = window.ISAAuth.logout(); const second = window.ISAAuth.logout();
  assert.equal(first, second); await first;
  assert.equal(writes, 1); assert.equal(location.href, '/auth/logout?ticket=' + 'a'.repeat(43));
});
test('logout aborts a stalled write without replaying it', async () => {
  const window = {}; let alerts = 0, writes = 0;
  const location = { origin: 'https://isaspectrum.celestivast.com', href: '/messages' };
  vm.runInNewContext(authSource, { window, location, URL, AbortController,
    setTimeout: callback => setTimeout(callback, 5), clearTimeout, alert: () => { alerts++; },
    fetch: async (url, init) => {
      if (url === '/auth/session') return new Response('{}');
      writes++; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }));
    }
  });
  await window.ISAAuth.logout();
  assert.equal(writes, 1); assert.equal(alerts, 1); assert.equal(location.href, '/messages');
});
