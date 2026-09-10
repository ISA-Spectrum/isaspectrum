function storeConfig(env) {
  const url = String(env.BUSINESS_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.BUSINESS_SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new Error('business_store_not_configured');
  return { url, key };
}

export async function requestStore(env, path, init = {}) {
  const { url, key } = storeConfig(env);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });
  if (!response.ok) throw new Error('business_store_failure');
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function createTransaction(env, transaction) {
  await requestStore(env, 'oauth_transactions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(transaction)
  });
}

export async function pruneAuthState(env) {
  await requestStore(env, 'rpc/prune_business_auth_state', {
    method: 'POST', body: '{}'
  });
}

export async function consumeTransaction(env, stateHash, bindingHash) {
  const rows = await requestStore(env, 'rpc/consume_oauth_transaction', {
    method: 'POST',
    body: JSON.stringify({ p_state_hash: stateHash, p_binding_hash: bindingHash })
  });
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

export async function resolveIdentity(env, identity) {
  const rows = await requestStore(env, 'rpc/resolve_oidc_identity', {
    method: 'POST',
    body: JSON.stringify({
      p_issuer: identity.issuer,
      p_subject: identity.subject,
      p_email: identity.email || null,
      p_display_name: identity.displayName || null
    })
  });
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].user_id || !rows[0].identity_id) {
    throw new Error('identity_mapping_failure');
  }
  return { userId: rows[0].user_id, identityId: rows[0].identity_id };
}

export async function createSession(env, session) {
  await requestStore(env, 'business_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(session)
  });
}

export async function readSession(env, sessionHash) {
  const rows = await requestStore(env, 'rpc/read_business_session', {
    method: 'POST',
    body: JSON.stringify({ p_session_hash: sessionHash })
  });
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

export async function rotateSession(env, previousHash, nextHash, expiresAt) {
  const result = await requestStore(env, 'rpc/rotate_business_session', {
    method: 'POST',
    body: JSON.stringify({
      p_previous_hash: previousHash,
      p_next_hash: nextHash,
      p_expires_at: expiresAt
    })
  });
  return result === true;
}

export async function revokeSession(env, sessionHash) {
  await requestStore(env, 'rpc/revoke_business_session', {
    method: 'POST',
    body: JSON.stringify({ p_session_hash: sessionHash })
  });
}
