export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json;charset=utf-8', ...headers }
  });
}

export function redirect(location, status = 303, headers = {}) {
  return new Response(null, {
    status,
    headers: { ...SECURITY_HEADERS, Location: location, ...headers }
  });
}

export function methodNotAllowed(allow) {
  return json({ error: 'method_not_allowed' }, 405, { Allow: allow });
}

export function parseCookies(request) {
  const values = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { values[name] = decodeURIComponent(value); } catch { values[name] = value; }
  }
  return values;
}

export function safeReturnPath(input, fallback = '/main.html') {
  if (!input) return fallback;
  const raw = String(input).trim();
  if (!raw || raw.includes('\\') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return fallback;
  const candidate = raw.startsWith('/') ? raw : `/${raw}`;
  let parsed;
  try { parsed = new URL(candidate, 'https://business.invalid'); } catch { return fallback; }
  if (parsed.origin !== 'https://business.invalid') return fallback;
  if (parsed.pathname.startsWith('/auth/')) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function sameOriginRequest(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export function cookieNames(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return {
    secure,
    session: secure ? '__Host-business_session' : 'business_session',
    transaction: secure ? '__Host-oauth_transaction' : 'oauth_transaction'
  };
}

export function setCookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearCookie(name, secure) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function oauthErrorRedirect(code) {
  // Only these identifiers may reach the browser. They are fixed internal names and
  // never contain token material, provider response bodies or user data.
  const safeCodes = new Set([
    'access_denied', 'invalid_request', 'invalid_grant', 'login_required',
    'interaction_required', 'state_mismatch', 'nonce_mismatch',
    'pkce_mismatch', 'expired_code', 'used_code', 'token_endpoint_failure',
    'authorization_server_unavailable', 'invalid_id_token',
    'configuration_error',
    // Granular ID Token / identity failures. Collapsing these into a single
    // "invalid_id_token" made real outages undiagnosable from the login page.
    'id_token_algorithm_mismatch', 'id_token_key_unavailable',
    'id_token_signature_invalid', 'id_token_issuer_mismatch',
    'id_token_audience_mismatch', 'id_token_expired', 'id_token_clock_skew',
    'id_token_invalid', 'identity_mismatch', 'business_store_unavailable',
    'client_authentication_failed'
  ]);
  const value = safeCodes.has(code) ? code : 'authentication_failed';
  return `/login.html?error=${encodeURIComponent(value)}`;
}
