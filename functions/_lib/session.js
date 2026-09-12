import { randomBase64Url, sha256Base64Url } from './crypto.js';
import { cookieNames, clearCookie, parseCookies, setCookie } from './http.js';
import { createSession, readSession, revokeSession, rotateSession } from './store.js';

export async function issueBusinessSession(request, env, config, identity, claims) {
  const token = randomBase64Url(32);
  const sessionHash = await sha256Base64Url(token);
  const expiresAt = new Date(Date.now() + config.sessionTtl * 1000).toISOString();
  const absoluteExpiresAt = new Date(Date.now() + config.sessionAbsoluteTtl * 1000).toISOString();
  await createSession(env, {
    session_hash: sessionHash,
    user_id: identity.userId,
    identity_provider: identity.identity_provider,
    identity_subject: identity.identity_subject,
    email: identity.email,
    display_name: identity.display_name,
    is_checker: identity.is_checker,
    expires_at: expiresAt,
    absolute_expires_at: absoluteExpiresAt,
    auth_time: Number.isFinite(claims.auth_time) ? new Date(claims.auth_time * 1000).toISOString() : null,
    amr: Array.isArray(claims.amr) ? claims.amr : [],
    acr: typeof claims.acr === 'string' ? claims.acr : null
  });
  const names = cookieNames(request);
  return setCookie(names.session, token, Math.min(config.sessionTtl, config.sessionAbsoluteTtl), names.secure);
}

export async function getBusinessSession(request, env, config, rotate = false) {
  const names = cookieNames(request);
  const token = parseCookies(request)[names.session];
  if (!token) return { session: null, setCookie: null };
  const currentHash = await sha256Base64Url(token);
  const session = await readSession(env, currentHash);
  if (!session) return { session: null, setCookie: clearCookie(names.session, names.secure) };

  const lastSeen = new Date(session.last_seen_at).getTime();
  if (!rotate || !Number.isFinite(lastSeen) || Date.now() - lastSeen < config.rotateAfter * 1000) {
    return { session, setCookie: null };
  }

  const nextToken = randomBase64Url(32);
  const nextHash = await sha256Base64Url(nextToken);
  const absoluteExpiry = Date.parse(session.absolute_expires_at);
  const expiresAt = new Date(Math.min(Date.now() + config.sessionTtl * 1000, absoluteExpiry)).toISOString();
  const rotated = await rotateSession(env, currentHash, nextHash, expiresAt);
  if (!rotated) return { session: null, setCookie: clearCookie(names.session, names.secure) };
  session.last_seen_at = new Date().toISOString();
  session.expires_at = expiresAt;
  const cookieTtl = Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
  return { session, setCookie: setCookie(names.session, nextToken, cookieTtl, names.secure) };
}

export async function destroyBusinessSession(request, env) {
  const names = cookieNames(request);
  const token = parseCookies(request)[names.session];
  if (token) {
    try { await revokeSession(env, await sha256Base64Url(token)); } catch {}
  }
  return clearCookie(names.session, names.secure);
}
