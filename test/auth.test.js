import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../functions/_lib/config.js';
import { sha256Base64Url } from '../functions/_lib/crypto.js';
import { cookieNames, safeReturnPath, setCookie } from '../functions/_lib/http.js';
import { buildAuthorizationUrl, exchangeCode, verifyIdToken } from '../functions/_lib/oidc.js';
import { authenticateApi } from '../functions/_lib/api.js';
import { onRequestGet as startLogin } from '../functions/auth/login.js';
import { onRequestGet as finishLogin } from '../functions/auth/callback.js';

function config(overrides = {}) {
  return getConfig({
    AUTH_ISSUER: 'https://auth.example.com',
    AUTH_CLIENT_ID: 'business-client',
    AUTH_REDIRECT_URI: 'https://www.example.com/auth/callback',
    BUSINESS_SUPABASE_URL: 'https://business.supabase.co',
    BUSINESS_SUPABASE_PUBLISHABLE_KEY: 'publishable-test',
    ...overrides
  });
}

test('PKCE uses the RFC 7636 S256 transform', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(await sha256Base64Url(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('authorization request has code, state, nonce and S256 but never the verifier', () => {
  const url = new URL(buildAuthorizationUrl(
    { authorization_endpoint: 'https://auth.example.com/oauth/authorize' },
    config(),
    { state: 'state', nonce: 'nonce', codeChallenge: 'challenge' }
  ));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.equal(url.searchParams.get('nonce'), 'nonce');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('code_verifier'), false);
  assert.equal(url.searchParams.has('acr_values'), false);
  assert.equal(url.searchParams.has('max_age'), false);
});

test('return destinations cannot become open redirects or auth loops', () => {
  assert.equal(safeReturnPath('https://evil.example/steal'), '/main.html');
  assert.equal(safeReturnPath('//evil.example/steal'), '/main.html');
  assert.equal(safeReturnPath('/auth/callback?code=x'), '/main.html');
  assert.equal(safeReturnPath('/details.html?id=7'), '/details.html?id=7');
});

test('production session cookie is host-only, HttpOnly, Secure and SameSite Lax', () => {
  const request = new Request('https://www.example.com/auth/session');
  const names = cookieNames(request);
  const cookie = setCookie(names.session, 'opaque', 300, names.secure);
  assert.equal(names.session, '__Host-business_session');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test('state-changing API requests reject missing or cross-site Origin before reading a session', async () => {
  const missing = await authenticateApi(new Request('https://www.example.com/api/profile', { method: 'PUT' }), {});
  assert.equal(missing.response.status, 403);
  const crossSite = await authenticateApi(new Request('https://www.example.com/api/profile', {
    method: 'PUT', headers: { Origin: 'https://evil.example' }
  }), {});
  assert.equal(crossSite.response.status, 403);
});

test('production issuer and redirect URI must use HTTPS', () => {
  assert.equal(config().issuer, 'https://auth.example.com');
  assert.equal(config({ AUTH_ISSUER: 'https://auth.example.com/' }).issuer, 'https://auth.example.com/');
  assert.throws(() => config({ AUTH_ISSUER: 'http://auth.example.com' }), /invalid_config/);
  assert.throws(() => config({ AUTH_REDIRECT_URI: 'http://www.example.com/auth/callback' }), /invalid_config/);
  assert.throws(() => config({ AUTH_REDIRECT_URI: 'https://www.example.com/other-callback' }), /invalid_config/);
  assert.throws(() => config({ OIDC_ALLOWED_ALGORITHMS: 'HS256' }), /invalid_config/);
  assert.throws(() => config({ BUSINESS_SESSION_TTL_SECONDS: '7200', BUSINESS_SESSION_ABSOLUTE_TTL_SECONDS: '3600' }), /invalid_config/);
});

test('confidential client authenticates at the token endpoint without placing its secret in the form', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.has('client_secret'), false);
    assert.equal(body.has('client_id'), false);
    const expected = Buffer.from('business-client:s%3Ae+cret').toString('base64');
    assert.equal(init.headers.Authorization, `Basic ${expected}`);
    return Response.json({ id_token: 'header.payload.signature' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await exchangeCode(
    { token_endpoint: 'https://auth.example.com/oauth/token', token_endpoint_auth_methods_supported: ['client_secret_basic'] },
    config({ AUTH_CLIENT_SECRET: 's:e cret' }),
    'code',
    'verifier'
  );
});

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('ID token verification checks signature, issuer, audience, time and nonce', async t => {
  const issuer = `https://auth-${Date.now()}.example.com`;
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  Object.assign(jwk, { kid: 'test-key', alg: 'RS256', use: 'sig' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const now = Math.floor(Date.now() / 1000);
  const accessToken = 'server-side-access-token';
  const accessDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)));
  const atHash = Buffer.from(accessDigest.slice(0, accessDigest.length / 2)).toString('base64url');
  const header = encoded({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const claims = { iss: issuer, sub: 'stable-subject', aud: 'business-client', exp: now + 300, iat: now, nonce: 'expected-nonce', at_hash: atHash };
  const payload = encoded(claims);
  const input = `${header}.${payload}`;
  const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input))).toString('base64url');
  const jwt = `${input}.${signature}`;
  const verified = await verifyIdToken(jwt, { issuer, jwks_uri: `${issuer}/jwks` }, config({ AUTH_ISSUER: issuer }), 'expected-nonce', accessToken);
  assert.equal(verified.sub, 'stable-subject');
  await assert.rejects(() => verifyIdToken(jwt, { issuer, jwks_uri: `${issuer}/jwks` }, config({ AUTH_ISSUER: issuer }), 'wrong-nonce', accessToken), /nonce_mismatch/);
  await assert.rejects(() => verifyIdToken(jwt, { issuer, jwks_uri: `${issuer}/jwks` }, config({ AUTH_ISSUER: issuer }), 'expected-nonce', 'wrong-token'), /invalid_access_token_hash/);
});

test('authorization callback consumes D1 state and uses an RLS-scoped database token', async t => {
  const suffix = Date.now();
  const issuer = `https://provider-${suffix}.example.com`;
  const businessOrigin = `https://business-${suffix}.example.com`;
  const storeOrigin = `https://store-${suffix}.supabase.co`;
  const providerPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const providerJwk = await crypto.subtle.exportKey('jwk', providerPair.publicKey);
  Object.assign(providerJwk, { kid: 'flow-key', alg: 'RS256', use: 'sig' });
  const databasePair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const databaseJwk = await crypto.subtle.exportKey('jwk', databasePair.privateKey);
  Object.assign(databaseJwk, { kid: 'database-key', alg: 'ES256', use: 'sig' });
  const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256']
  };
  let transaction;
  let sessionRecord;
  let state;
  let consumed = false;
  const d1 = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() {
          if (sql.includes('insert into oauth_transactions')) {
            transaction = {
              state_hash: this.args[0], browser_binding_hash: this.args[1], code_verifier: this.args[2],
              nonce: this.args[3], redirect_path: this.args[4], expires_at: this.args[6]
            };
          } else if (sql.includes('insert into business_sessions')) {
            sessionRecord = { session_hash: this.args[0], user_id: this.args[1], amr: JSON.parse(this.args[12]) };
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (!sql.includes('delete from oauth_transactions') || consumed) return null;
          assert.equal(this.args[0], await sha256Base64Url(state));
          assert.equal(this.args[1], transaction.browser_binding_hash);
          consumed = true;
          return { code_verifier: transaction.code_verifier, nonce: transaction.nonce, redirect_path: transaction.redirect_path };
        }
      };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  };
  const env = {
    AUTH_ISSUER: issuer,
    AUTH_CLIENT_ID: 'business-client',
    AUTH_REDIRECT_URI: `${businessOrigin}/auth/callback`,
    BUSINESS_SUPABASE_URL: storeOrigin,
    BUSINESS_SUPABASE_PUBLISHABLE_KEY: 'publishable-test',
    BUSINESS_SUPABASE_SIGNING_JWK: JSON.stringify(databaseJwk),
    AUTH_DB: d1
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery);
    if (url === discovery.token_endpoint) {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('code'), 'one-time-code');
      assert.equal(body.get('client_id'), 'business-client');
      assert.equal(body.get('code_verifier'), transaction.code_verifier);
      const now = Math.floor(Date.now() / 1000);
      const header = encoded({ alg: 'RS256', kid: 'flow-key', typ: 'JWT' });
      const payload = encoded({ iss: issuer, sub: 'subject-123', aud: 'business-client', exp: now + 300, iat: now, nonce: transaction.nonce, amr: ['webauthn'] });
      const signingInput = `${header}.${payload}`;
      const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', providerPair.privateKey, new TextEncoder().encode(signingInput))).toString('base64url');
      return Response.json({ id_token: `${signingInput}.${signature}`, access_token: 'ephemeral-provider-token', token_type: 'Bearer' });
    }
    if (url === discovery.jwks_uri) return Response.json({ keys: [providerJwk] });
    if (url === discovery.userinfo_endpoint) return Response.json({ sub: 'subject-123', email: 'student@example.com', name: 'Student' });
    if (url.startsWith(`${storeOrigin}/rest/v1/business_users`)) {
      assert.equal(init.headers.apikey, 'publishable-test');
      const token = init.headers.Authorization.replace('Bearer ', '');
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      assert.equal(await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        databasePair.publicKey,
        Buffer.from(parts[2], 'base64url'),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
      ), true);
      assert.equal(payload.role, 'authenticated');
      assert.equal(payload.provider_iss, issuer);
      assert.equal(payload.provider_sub, 'subject-123');
      assert.notEqual(payload.role, 'service_role');
      return Response.json([{ user_id: payload.sub, is_checker: false }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const started = await startLogin({
    request: new Request(`${businessOrigin}/auth/login?return_to=${encodeURIComponent('/details.html?id=9')}`), env
  });
  assert.equal(started.status, 302);
  const authorize = new URL(started.headers.get('location'));
  state = authorize.searchParams.get('state');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.has('code_verifier'), false);
  const transactionCookie = started.headers.get('set-cookie').split(';')[0];

  const completed = await finishLogin({
    request: new Request(`${businessOrigin}/auth/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: transactionCookie }
    }),
    env
  });
  assert.equal(completed.status, 303);
  assert.equal(completed.headers.get('location'), '/details.html?id=9');
  assert.match(completed.headers.get('set-cookie'), /__Host-business_session=/);
  assert.match(sessionRecord.user_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(sessionRecord.amr, ['webauthn']);
  assert.equal('access_token' in sessionRecord, false);
  assert.equal('id_token' in sessionRecord, false);

  const replayed = await finishLogin({
    request: new Request(`${businessOrigin}/auth/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: transactionCookie }
    }),
    env
  });
  assert.equal(replayed.status, 303);
  assert.equal(replayed.headers.get('location'), '/login.html?error=state_mismatch');
});
