import { base64UrlEncode, utf8 } from './crypto.js';

const keyCache = new Map();

function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`missing_config:${name}`);
  return value;
}

function publicSupabaseConfig(env) {
  const url = required(env, 'BUSINESS_SUPABASE_URL').replace(/\/$/, '');
  const publishableKey = required(env, 'BUSINESS_SUPABASE_PUBLISHABLE_KEY');
  return { url, publishableKey };
}

function supabaseConfig(env) {
  const { url, publishableKey } = publicSupabaseConfig(env);
  const rawJwk = required(env, 'BUSINESS_SUPABASE_SIGNING_JWK');
  let jwk;
  try { jwk = JSON.parse(rawJwk); } catch { throw new Error('invalid_config:BUSINESS_SUPABASE_SIGNING_JWK'); }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.kid) {
    throw new Error('invalid_config:BUSINESS_SUPABASE_SIGNING_JWK');
  }
  return { url, publishableKey, jwk };
}

async function signingKey(jwk) {
  const cacheKey = `${jwk.kid}:${jwk.x}:${jwk.y}`;
  if (!keyCache.has(cacheKey)) {
    keyCache.set(cacheKey, crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
    ));
  }
  return keyCache.get(cacheKey);
}

export async function identityUserId(issuer, subject) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(`${issuer}\u0000${subject}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function createDatabaseToken(env, identity) {
  const { url, jwk } = supabaseConfig(env);
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(utf8(JSON.stringify({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' })));
  const payload = base64UrlEncode(utf8(JSON.stringify({
    iss: `${url}/auth/v1`,
    sub: identity.user_id,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 300,
    email: identity.email || undefined,
    provider_iss: identity.identity_provider,
    provider_sub: identity.identity_subject
  })));
  const input = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, await signingKey(jwk), utf8(input)
  ));
  return `${input}.${base64UrlEncode(signature)}`;
}

async function requestSupabase(env, session, route, init = {}) {
  const { url, publishableKey } = supabaseConfig(env);
  const token = await createDatabaseToken(env, session);
  const response = await fetch(`${url}/${route}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });
  if (!response.ok) throw new Error('business_store_failure');
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function requestBusinessData(env, session, path, init = {}) {
  return requestSupabase(env, session, `rest/v1/${path}`, init);
}

export async function requestPublicData(env, path, init = {}) {
  const { url, publishableKey } = publicSupabaseConfig(env);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });
  if (!response.ok) throw new Error('business_store_failure');
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function uploadBusinessObject(env, session, bucket, path, file, upsert = false) {
  const { url, publishableKey } = supabaseConfig(env);
  const token = await createDatabaseToken(env, session);
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type,
      'x-upsert': upsert ? 'true' : 'false'
    },
    body: file
  });
  if (!response.ok) throw new Error('upload_failed');
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}

export async function resolveIdentity(env, claims) {
  const userId = await identityUserId(claims.issuer, claims.subject);
  const session = {
    user_id: userId,
    identity_provider: claims.issuer,
    identity_subject: claims.subject,
    email: claims.email,
    display_name: claims.displayName
  };
  const rows = await requestBusinessData(env, session, 'business_users?on_conflict=user_id&select=user_id,is_checker', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      user_id: userId,
      identity_provider: claims.issuer,
      identity_subject: claims.subject,
      email: claims.email,
      display_name: claims.displayName,
      last_login_at: new Date().toISOString()
    })
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('identity_mapping_failure');
  return { ...session, userId, is_checker: rows[0].is_checker === true };
}

export async function refreshChecker(env, session) {
  const rows = await requestBusinessData(env, session,
    `business_users?user_id=eq.${encodeURIComponent(session.user_id)}&select=is_checker&limit=1`
  );
  return rows?.[0]?.is_checker === true;
}
