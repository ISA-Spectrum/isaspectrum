import { getConfig } from '../_lib/config.js';
import { sha256Base64Url } from '../_lib/crypto.js';
import { clearCookie, cookieNames, methodNotAllowed, oauthErrorRedirect, parseCookies } from '../_lib/http.js';
import { discover, exchangeCode, fetchUserInfo, verifyIdToken } from '../_lib/oidc.js';
import { destroyBusinessSession, issueBusinessSession } from '../_lib/session.js';
import { consumeTransaction, resolveIdentity } from '../_lib/store.js';

function responseWithClearedTransaction(request, location, additionalCookie = null) {
  const names = cookieNames(request);
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    Location: location
  });
  headers.append('Set-Cookie', clearCookie(names.transaction, names.secure));
  if (additionalCookie) headers.append('Set-Cookie', additionalCookie);
  return new Response(null, { status: 303, headers });
}

export async function onRequestGet({ request, env }) {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  const providerError = requestUrl.searchParams.get('error');
  let config;
  try { config = getConfig(env); } catch { return responseWithClearedTransaction(request, oauthErrorRedirect('configuration_error')); }

  const names = cookieNames(request);
  const binding = parseCookies(request)[names.transaction];
  if (!state || !binding) return responseWithClearedTransaction(request, oauthErrorRedirect('state_mismatch'));

  let transaction;
  try {
    transaction = await consumeTransaction(env, await sha256Base64Url(state), await sha256Base64Url(binding));
  } catch {
    return responseWithClearedTransaction(request, oauthErrorRedirect('authentication_failed'));
  }
  if (!transaction) return responseWithClearedTransaction(request, oauthErrorRedirect('state_mismatch'));
  if (providerError) return responseWithClearedTransaction(request, oauthErrorRedirect(providerError));
  if (!code) return responseWithClearedTransaction(request, oauthErrorRedirect('invalid_request'));

  try {
    const discovery = await discover(config);
    const tokenSet = await exchangeCode(discovery, config, code, transaction.code_verifier);
    const claims = await verifyIdToken(tokenSet.id_token, discovery, config, transaction.nonce, tokenSet.access_token || null);
    const userInfo = await fetchUserInfo(discovery, tokenSet, claims.sub);
    const rawEmail = userInfo?.email || claims.email;
    const rawDisplayName = userInfo?.name || claims.name || claims.preferred_username;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().slice(0, 320) || null : null;
    const displayName = typeof rawDisplayName === 'string'
      ? rawDisplayName.trim().slice(0, 120) || null
      : null;
    const identity = await resolveIdentity(env, {
      issuer: claims.iss,
      subject: claims.sub,
      email,
      displayName
    });
    await destroyBusinessSession(request, env);
    const sessionCookie = await issueBusinessSession(request, env, config, identity, claims);
    return responseWithClearedTransaction(request, transaction.redirect_path, sessionCookie);
  } catch (error) {
    const safeErrors = new Set([
      'authorization_server_unavailable', 'invalid_grant', 'token_endpoint_failure',
      'nonce_mismatch', 'invalid_id_token'
    ]);
    const codeName = safeErrors.has(error.message) ? error.message : 'invalid_id_token';
    return responseWithClearedTransaction(request, oauthErrorRedirect(codeName));
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
