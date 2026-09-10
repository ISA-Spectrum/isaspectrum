import { base64UrlDecode, base64UrlEncode, parseJwtPart, timingSafeEqual, utf8 } from './crypto.js';

const discoveryCache = new Map();
const jwksCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function trustedHttpsUrl(value, allowLocalHttp = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:')) {
    throw new Error('untrusted_oidc_endpoint');
  }
  return url.toString();
}

async function cachedJson(cache, key, request, force = false) {
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  let response;
  try {
    response = await fetch(request, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('authorization_server_unavailable');
  }
  if (!response.ok) throw new Error('authorization_server_unavailable');
  let value;
  try { value = await response.json(); } catch { throw new Error('authorization_server_unavailable'); }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function discover(config, force = false) {
  const discoveryUrl = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const document = await cachedJson(discoveryCache, config.issuer, discoveryUrl, force);
  if (document.issuer !== config.issuer) throw new Error('invalid_discovery_issuer');
  const allowLocal = new URL(config.issuer).protocol === 'http:';
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (!document[field]) throw new Error(`invalid_discovery:${field}`);
    trustedHttpsUrl(document[field], allowLocal);
  }
  if (!Array.isArray(document.response_types_supported) || !document.response_types_supported.includes('code')) {
    throw new Error('authorization_code_not_supported');
  }
  if (Array.isArray(document.code_challenge_methods_supported) && !document.code_challenge_methods_supported.includes('S256')) {
    throw new Error('pkce_s256_not_supported');
  }
  return document;
}

export function buildAuthorizationUrl(discovery, config, transaction) {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', transaction.state);
  url.searchParams.set('nonce', transaction.nonce);
  url.searchParams.set('code_challenge', transaction.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function tokenAuth(discovery, config, body, headers) {
  if (!config.clientSecret) {
    body.set('client_id', config.clientId);
    return;
  }
  const supported = discovery.token_endpoint_auth_methods_supported || ['client_secret_basic'];
  if (supported.includes('client_secret_basic')) {
    const formEncode = value => new URLSearchParams({ value }).toString().slice('value='.length);
    const bytes = utf8(`${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    headers.Authorization = `Basic ${btoa(binary)}`;
  } else if (supported.includes('client_secret_post')) {
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
  } else {
    throw new Error('unsupported_token_auth_method');
  }
}

export async function exchangeCode(discovery, config, code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier
  });
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  tokenAuth(discovery, config, body, headers);

  let response;
  try {
    response = await fetch(discovery.token_endpoint, { method: 'POST', headers, body });
  } catch {
    throw new Error('authorization_server_unavailable');
  }
  if (!response.ok) {
    let codeName = '';
    try { codeName = (await response.json()).error || ''; } catch {}
    if (codeName === 'invalid_grant') throw new Error('invalid_grant');
    throw new Error('token_endpoint_failure');
  }
  let tokenSet;
  try { tokenSet = await response.json(); } catch { throw new Error('token_endpoint_failure'); }
  if (!tokenSet.id_token) throw new Error('invalid_id_token');
  if (tokenSet.access_token && String(tokenSet.token_type || '').toLowerCase() !== 'bearer') {
    throw new Error('token_endpoint_failure');
  }
  return tokenSet;
}

function verificationAlgorithm(alg) {
  if (alg === 'RS256') {
    return {
      import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      verify: { name: 'RSASSA-PKCS1-v1_5' }
    };
  }
  if (alg === 'PS256') {
    return {
      import: { name: 'RSA-PSS', hash: 'SHA-256' },
      verify: { name: 'RSA-PSS', saltLength: 32 }
    };
  }
  if (alg === 'ES256') {
    return {
      import: { name: 'ECDSA', namedCurve: 'P-256' },
      verify: { name: 'ECDSA', hash: 'SHA-256' }
    };
  }
  throw new Error('unsupported_id_token_algorithm');
}

async function fetchJwks(discovery, force = false) {
  const document = await cachedJson(jwksCache, discovery.jwks_uri, discovery.jwks_uri, force);
  if (!Array.isArray(document.keys)) throw new Error('invalid_jwks');
  return document.keys;
}

function selectKey(keys, header) {
  const candidates = keys.filter(key =>
    (!header.kid || key.kid === header.kid) &&
    (!key.use || key.use === 'sig') &&
    (!key.alg || key.alg === header.alg)
  );
  if (candidates.length !== 1) throw new Error('id_token_key_not_found');
  return candidates[0];
}

async function verifySignature(jwt, header, key) {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.');
  const algorithm = verificationAlgorithm(header.alg);
  const cryptoKey = await crypto.subtle.importKey('jwk', key, algorithm.import, false, ['verify']);
  const valid = await crypto.subtle.verify(
    algorithm.verify,
    cryptoKey,
    base64UrlDecode(encodedSignature),
    utf8(`${encodedHeader}.${encodedPayload}`)
  );
  if (!valid) throw new Error('invalid_id_token_signature');
}

function validateClaims(claims, discovery, config, nonce) {
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== discovery.issuer) throw new Error('invalid_id_token_issuer');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) throw new Error('invalid_id_token_audience');
  if (audiences.length > 1 && claims.azp !== config.clientId) throw new Error('invalid_id_token_authorized_party');
  if (!Number.isFinite(claims.exp) || claims.exp <= now - config.clockSkew) throw new Error('expired_id_token');
  if (!Number.isFinite(claims.iat) || claims.iat > now + config.clockSkew || claims.iat < now - config.maxIatAge - config.clockSkew) {
    throw new Error('invalid_id_token_issued_at');
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('invalid_id_token_subject');
  if (typeof claims.nonce !== 'string' || !timingSafeEqual(claims.nonce, nonce)) throw new Error('nonce_mismatch');
  if (claims.auth_time !== undefined && (!Number.isFinite(claims.auth_time) || claims.auth_time > now + config.clockSkew)) {
    throw new Error('invalid_auth_time');
  }
  if (claims.amr !== undefined && (!Array.isArray(claims.amr) || claims.amr.some(value => typeof value !== 'string'))) {
    throw new Error('invalid_amr');
  }
}

export async function verifyIdToken(idToken, discovery, config, nonce, accessToken = null) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error('invalid_id_token');
  const header = parseJwtPart(parts[0]);
  const claims = parseJwtPart(parts[1]);
  if (!config.allowedAlgorithms.has(header.alg) || header.alg === 'none') throw new Error('unsupported_id_token_algorithm');

  let keys = await fetchJwks(discovery);
  let key;
  try { key = selectKey(keys, header); } catch {
    keys = await fetchJwks(discovery, true);
    key = selectKey(keys, header);
  }
  try {
    await verifySignature(idToken, header, key);
  } catch (error) {
    if (error.message !== 'invalid_id_token_signature') throw error;
    keys = await fetchJwks(discovery, true);
    key = selectKey(keys, header);
    await verifySignature(idToken, header, key);
  }
  validateClaims(claims, discovery, config, nonce);
  if (claims.at_hash !== undefined) {
    if (typeof claims.at_hash !== 'string' || !accessToken) throw new Error('invalid_access_token_hash');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(accessToken)));
    const expected = base64UrlEncode(digest.slice(0, digest.length / 2));
    if (!timingSafeEqual(expected, claims.at_hash)) throw new Error('invalid_access_token_hash');
  }
  return claims;
}

export async function fetchUserInfo(discovery, tokenSet, expectedSubject) {
  if (!discovery.userinfo_endpoint || !tokenSet.access_token) return null;
  let response;
  try {
    response = await fetch(discovery.userinfo_endpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${tokenSet.access_token}` }
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let profile;
  try { profile = await response.json(); } catch { return null; }
  if (profile.sub !== expectedSubject) throw new Error('userinfo_subject_mismatch');
  return profile;
}
