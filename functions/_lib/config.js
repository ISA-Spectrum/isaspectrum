function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`missing_config:${name}`);
  return value;
}

function integer(env, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(env[name] || fallback, 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`invalid_config:${name}`);
  }
  return parsed;
}

function absoluteUrl(value, name, allowLocalHttp = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid_config:${name}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:')) {
    throw new Error(`invalid_config:${name}`);
  }
  return url.toString();
}

export function getConfig(env) {
  const allowLocalHttp = env.AUTH_ALLOW_INSECURE_LOCALHOST === '1';
  const issuerInput = required(env, 'AUTH_ISSUER');
  if (issuerInput.length > 500) throw new Error('invalid_config:AUTH_ISSUER');
  const issuerUrl = absoluteUrl(issuerInput, 'AUTH_ISSUER', allowLocalHttp);
  const issuer = issuerInput.endsWith('/') ? issuerUrl : issuerUrl.replace(/\/$/, '');
  const redirectUri = absoluteUrl(required(env, 'AUTH_REDIRECT_URI'), 'AUTH_REDIRECT_URI', allowLocalHttp);
  const issuerParsed = new URL(issuer);
  const redirectParsed = new URL(redirectUri);
  if (issuerParsed.search || issuerParsed.hash) throw new Error('invalid_config:AUTH_ISSUER');
  if (redirectParsed.pathname !== '/auth/callback' || redirectParsed.search || redirectParsed.hash) {
    throw new Error('invalid_config:AUTH_REDIRECT_URI');
  }
  const scopes = String(env.AUTH_SCOPES || 'openid profile email').trim().split(/\s+/).filter(Boolean);
  if (!scopes.includes('openid')) throw new Error('invalid_config:AUTH_SCOPES_requires_openid');
  const sessionTtl = integer(env, 'BUSINESS_SESSION_TTL_SECONDS', 28800, 300, 2592000);
  const sessionAbsoluteTtl = integer(env, 'BUSINESS_SESSION_ABSOLUTE_TTL_SECONDS', 604800, 3600, 2592000);
  if (sessionAbsoluteTtl < sessionTtl) throw new Error('invalid_config:BUSINESS_SESSION_ABSOLUTE_TTL_SECONDS');
  const businessSupabaseUrl = absoluteUrl(required(env, 'BUSINESS_SUPABASE_URL'), 'BUSINESS_SUPABASE_URL', allowLocalHttp).replace(/\/$/, '');
  const businessParsed = new URL(businessSupabaseUrl);
  if (businessParsed.pathname !== '/' || businessParsed.search || businessParsed.hash) {
    throw new Error('invalid_config:BUSINESS_SUPABASE_URL');
  }
  const allowedAlgorithms = new Set(String(env.OIDC_ALLOWED_ALGORITHMS || 'RS256').split(',').map(value => value.trim()).filter(Boolean));
  if (!allowedAlgorithms.size || [...allowedAlgorithms].some(value => !['RS256', 'PS256', 'ES256'].includes(value))) {
    throw new Error('invalid_config:OIDC_ALLOWED_ALGORITHMS');
  }
  // Optional: where the provider should send the browser after RP-initiated logout. It
  // must also be registered in the client's "Valid post logout redirect URIs". Left
  // unset on purpose by default, so logout lands on the provider's own confirmation page
  // instead of risking a rejection for an unregistered URI.
  let postLogoutRedirect = null;
  const postLogoutInput = String(env.AUTH_POST_LOGOUT_REDIRECT || '').trim();
  if (postLogoutInput) {
    try { postLogoutRedirect = absoluteUrl(postLogoutInput, 'AUTH_POST_LOGOUT_REDIRECT', allowLocalHttp); } catch { postLogoutRedirect = null; }
  }

  return {
    issuer,
    clientId: required(env, 'AUTH_CLIENT_ID'),
    clientSecret: String(env.AUTH_CLIENT_SECRET || '').trim() || null,
    redirectUri,
    scopes,
    transactionTtl: integer(env, 'OAUTH_TRANSACTION_TTL_SECONDS', 600, 60, 1800),
    sessionTtl,
    sessionAbsoluteTtl,
    rotateAfter: integer(env, 'BUSINESS_SESSION_ROTATE_AFTER_SECONDS', 1800, 60, 86400),
    clockSkew: integer(env, 'OIDC_CLOCK_SKEW_SECONDS', 60, 0, 300),
    maxIatAge: integer(env, 'OIDC_MAX_IAT_AGE_SECONDS', 600, 60, 3600),
    allowedAlgorithms,
    // Keycloak (and several other providers) only put the realm/`account` audience in
    // the ID Token unless an "Audience" protocol mapper is configured on the client.
    // With this enabled the client id is still proven by the signed `azp` claim, and
    // every other audience value must belong to this exact issuer. Default: strict.
    acceptAzpAsAudience: env.OIDC_ACCEPT_AZP_AS_AUDIENCE === '1',
    postLogoutRedirect,
    businessSupabaseUrl,
    businessSupabasePublishableKey: required(env, 'BUSINESS_SUPABASE_PUBLISHABLE_KEY')
  };
}
