import { getConfig } from '../_lib/config.js';
import { sha256Base64Url } from '../_lib/crypto.js';
import { clearCookie, cookieNames, methodNotAllowed, oauthErrorRedirect, parseCookies } from '../_lib/http.js';
import { discover, exchangeCode, fetchUserInfo, verifyIdToken } from '../_lib/oidc.js';
import { destroyBusinessSession, issueBusinessSession } from '../_lib/session.js';
import { consumeTransaction } from '../_lib/store.js';
import { resolveIdentity } from '../_lib/supabase.js';

// Maps an internal failure name to the coarse identifier put in the login URL.
// Distinct identifiers matter: a Keycloak audience-mapper gap, a rotated signing
// key, clock skew and a business-store outage all used to collapse into a single
// "invalid_id_token", which made real outages impossible to tell apart.
const ERROR_CODES = {
  authorization_server_unavailable: 'authorization_server_unavailable',
  invalid_discovery_issuer: 'configuration_error',
  authorization_code_not_supported: 'configuration_error',
  pkce_s256_not_supported: 'configuration_error',
  unsupported_token_auth_method: 'configuration_error',
  invalid_grant: 'invalid_grant',
  invalid_client: 'client_authentication_failed',
  token_endpoint_failure: 'token_endpoint_failure',
  nonce_mismatch: 'nonce_mismatch',
  unsupported_id_token_algorithm: 'id_token_algorithm_mismatch',
  invalid_jwks: 'id_token_key_unavailable',
  id_token_key_not_found: 'id_token_key_unavailable',
  invalid_id_token_signature: 'id_token_signature_invalid',
  invalid_id_token_issuer: 'id_token_issuer_mismatch',
  invalid_id_token_audience: 'id_token_audience_mismatch',
  invalid_id_token_authorized_party: 'id_token_audience_mismatch',
  expired_id_token: 'id_token_expired',
  invalid_id_token_issued_at: 'id_token_clock_skew',
  invalid_auth_time: 'id_token_clock_skew',
  invalid_id_token: 'id_token_invalid',
  invalid_id_token_subject: 'id_token_invalid',
  invalid_amr: 'id_token_invalid',
  invalid_access_token_hash: 'id_token_invalid',
  userinfo_subject_mismatch: 'identity_mismatch',
  business_store_failure: 'business_store_unavailable',
  identity_mapping_failure: 'business_store_unavailable'
};

export function callbackErrorCode(message) {
  const name = String(message || '');
  if (name.startsWith('missing_config:') || name.startsWith('invalid_config:')) return 'configuration_error';
  return ERROR_CODES[name] || 'authentication_failed';
}

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
  let stage = 'config';
  let config;
  try { config = getConfig(env); } catch { return responseWithClearedTransaction(request, oauthErrorRedirect('configuration_error')); }

  const names = cookieNames(request);
  const binding = parseCookies(request)[names.transaction];
  if (!state || !binding) return responseWithClearedTransaction(request, oauthErrorRedirect('state_mismatch'));

  let transaction;
  try {
    stage = 'consume-transaction';
    transaction = await consumeTransaction(env, await sha256Base64Url(state), await sha256Base64Url(binding));
  } catch {
    return responseWithClearedTransaction(request, oauthErrorRedirect('authentication_failed'));
  }
  if (!transaction) return responseWithClearedTransaction(request, oauthErrorRedirect('state_mismatch'));
  if (providerError) return responseWithClearedTransaction(request, oauthErrorRedirect(providerError));
  if (!code) return responseWithClearedTransaction(request, oauthErrorRedirect('invalid_request'));

  try {
    stage = 'discovery';
    const discovery = await discover(config);
    stage = 'token-exchange';
    const tokenSet = await exchangeCode(discovery, config, code, transaction.code_verifier);
    stage = 'id-token-verification';
    const claims = await verifyIdToken(tokenSet.id_token, discovery, config, transaction.nonce, tokenSet.access_token || null);
    stage = 'userinfo';
    const userInfo = await fetchUserInfo(discovery, tokenSet, claims.sub);
    const rawEmail = userInfo?.email || claims.email;
    const rawDisplayName = userInfo?.name || claims.name || claims.preferred_username;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().slice(0, 320) || null : null;
    const displayName = typeof rawDisplayName === 'string'
      ? rawDisplayName.trim().slice(0, 120) || null
      : null;
    stage = 'identity-mapping';
    const identity = await resolveIdentity(env, {
      issuer: claims.iss,
      subject: claims.sub,
      email,
      displayName
    });
    stage = 'session-issue';
    await destroyBusinessSession(request, env);
    const sessionCookie = await issueBusinessSession(request, env, config, identity, claims);
    return responseWithClearedTransaction(request, transaction.redirect_path, sessionCookie);
  } catch (error) {
    // Log the failure for `wrangler pages deployment tail`. Only the internal name
    // is recorded: the query string carries the authorization code and is never logged.
    console.error(`[auth/callback] stage=${stage} error=${String(error && error.message).slice(0, 120)}`);
    return responseWithClearedTransaction(request, oauthErrorRedirect(callbackErrorCode(error && error.message)));
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
