import { getConfig } from '../_lib/config.js';
import { json, methodNotAllowed, sameOriginRequest, safeReturnPath, redirect, parseCookies } from '../_lib/http.js';
import { randomBase64Url, sha256Base64Url } from '../_lib/crypto.js';
import { createTransaction, consumeTransaction } from '../_lib/store.js';
import { discover } from '../_lib/oidc.js';
import { destroyBusinessSession, getBusinessSession } from '../_lib/session.js';

const FLOW_TTL = 120;
const flowName = request => new URL(request.url).protocol === 'https:' ? '__Host-logout_flow' : 'logout_flow';
function flowCookie(request, value, ttl = FLOW_TTL) {
  return `${flowName(request)}=${value}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
const flowHash = value => sha256Base64Url(`logout:${value}`);

async function providerLogoutUrl(config, rawIdToken) {
  const discovery = await discover(config);
  if (!discovery.end_session_endpoint) return null;
  const url = new URL(discovery.end_session_endpoint);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(config.issuer.startsWith('http:') && local && url.protocol === 'http:'))) return null;
  url.searchParams.set('client_id', config.clientId);
  if (config.postLogoutRedirect) url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirect);
  if (rawIdToken) url.searchParams.set('id_token_hint', rawIdToken);
  return url.toString();
}

// GET can only consume a short-lived browser-bound flow created by POST. It
// never reads or revokes a business session. Token-bearing URLs stay server-side.
export async function onRequestGet({ request, env }) {
  const ticket = new URL(request.url).searchParams.get('ticket');
  const binding = parseCookies(request)[flowName(request)];
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket || '') || !/^[A-Za-z0-9_-]{43}$/.test(binding || '')) return methodNotAllowed('POST');
  let flow;
  try { flow = await consumeTransaction(env, await flowHash(ticket), await flowHash(binding)); }
  catch { return json({ error: 'logout_flow_unavailable' }, 503); }
  if (!flow || flow.nonce !== 'logout') return json({ error: 'invalid_logout_flow' }, 400);
  return redirect(flow.code_verifier, 303, { 'Set-Cookie': flowCookie(request, '', 0) });
}

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return json({ error: 'invalid_origin' }, 403);
  let session, cookie, config;
  try {
    config = getConfig(env);
    ({ session } = await getBusinessSession(request, env, config));
    cookie = await destroyBusinessSession(request, env, true);
  } catch { return json({ error: 'session_unavailable' }, 503); }
  let body = {};
  try { body = await request.json(); } catch {}
  const returnTo = safeReturnPath(body?.returnTo, '/main');
  let logoutPath = null, binding = null;
  try {
    const providerUrl = session?.user_id ? await providerLogoutUrl(config, session.id_token_raw) : null;
    if (providerUrl) {
      const ticket = randomBase64Url(32);
      binding = randomBase64Url(32);
      await createTransaction(env, {
        state_hash: await flowHash(ticket), browser_binding_hash: await flowHash(binding),
        code_verifier: providerUrl, nonce: 'logout', redirect_path: returnTo,
        expires_at: new Date(Date.now() + FLOW_TTL * 1000).toISOString()
      });
      logoutPath = `/auth/logout?ticket=${ticket}`;
    }
  } catch { binding = null; } // Local logout is complete even if SSO is unavailable.
  const response = json({ logoutPath, returnTo, providerLogoutAvailable: Boolean(logoutPath) }, 200, { 'Set-Cookie': cookie });
  if (logoutPath) response.headers.append('Set-Cookie', flowCookie(request, binding));
  return response;
}

export function onRequest() { return methodNotAllowed('GET, POST'); }
