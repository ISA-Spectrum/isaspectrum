import { getConfig } from '../_lib/config.js';
import { randomBase64Url, sha256Base64Url } from '../_lib/crypto.js';
import { cookieNames, json, methodNotAllowed, redirect, safeReturnPath, setCookie } from '../_lib/http.js';
import { buildAuthorizationUrl, discover } from '../_lib/oidc.js';
import { createTransaction, pruneAuthState } from '../_lib/store.js';

export async function onRequestGet({ request, env }) {
  let config;
  try { config = getConfig(env); } catch { return json({ error: 'configuration_error' }, 503); }

  const requestUrl = new URL(request.url);
  const redirectPath = safeReturnPath(requestUrl.searchParams.get('return_to') || requestUrl.searchParams.get('returnTo'));

  try {
    const discovery = await discover(config);
    try { await pruneAuthState(env); } catch {}
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const browserBinding = randomBase64Url(32);
    await createTransaction(env, {
      state_hash: await sha256Base64Url(state),
      browser_binding_hash: await sha256Base64Url(browserBinding),
      code_verifier: codeVerifier,
      nonce,
      redirect_path: redirectPath,
      expires_at: new Date(Date.now() + config.transactionTtl * 1000).toISOString()
    });
    const names = cookieNames(request);
    return redirect(buildAuthorizationUrl(discovery, config, {
      state, nonce, codeChallenge
    }), 302, {
      'Set-Cookie': setCookie(names.transaction, browserBinding, config.transactionTtl, names.secure)
    });
  } catch (error) {
    const unavailable = error.message === 'authorization_server_unavailable';
    return json({ error: unavailable ? 'authorization_server_unavailable' : 'configuration_error' }, unavailable ? 502 : 503);
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
