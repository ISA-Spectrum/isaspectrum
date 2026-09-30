function authDb(env) {
  const db = env.AUTH_DB;
  if (!db || typeof db.prepare !== 'function') throw new Error('auth_store_not_configured');
  return db;
}

export async function createTransaction(env, transaction) {
  await authDb(env).prepare(`
    insert into oauth_transactions
      (state_hash, browser_binding_hash, code_verifier, nonce, redirect_path, created_at, expires_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    transaction.state_hash,
    transaction.browser_binding_hash,
    transaction.code_verifier,
    transaction.nonce,
    transaction.redirect_path,
    transaction.created_at || new Date().toISOString(),
    transaction.expires_at
  ).run();
}

export async function pruneAuthState(env) {
  const db = authDb(env);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('delete from oauth_transactions where expires_at <= ?').bind(now),
    db.prepare('delete from business_sessions where expires_at <= ? or absolute_expires_at <= ? or (revoked_at is not null and revoked_at < ?)')
      .bind(now, now, new Date(Date.now() - 86400000).toISOString())
  ]);
}

export async function consumeTransaction(env, stateHash, bindingHash) {
  return authDb(env).prepare(`
    delete from oauth_transactions
    where state_hash = ? and browser_binding_hash = ? and expires_at > ?
    returning code_verifier, nonce, redirect_path
  `).bind(stateHash, bindingHash, new Date().toISOString()).first();
}

export async function createSession(env, session) {
  await authDb(env).prepare(`
    insert into business_sessions (
      session_hash, user_id, identity_provider, identity_subject, email, display_name,
      is_checker, created_at, last_seen_at, expires_at, absolute_expires_at,
      auth_time, amr, acr
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    session.session_hash,
    session.user_id,
    session.identity_provider,
    session.identity_subject,
    session.email,
    session.display_name,
    session.is_checker ? 1 : 0,
    session.created_at || new Date().toISOString(),
    session.last_seen_at || new Date().toISOString(),
    session.expires_at,
    session.absolute_expires_at,
    session.auth_time,
    JSON.stringify(session.amr || []),
    session.acr
  ).run();
}

function normalizeSession(row) {
  if (!row) return null;
  let amr = [];
  try { amr = JSON.parse(row.amr || '[]'); } catch {}
  return { ...row, is_checker: row.is_checker === 1, amr };
}

export async function readSession(env, sessionHash) {
  const now = new Date().toISOString();
  const row = await authDb(env).prepare(`
    select * from business_sessions
    where (session_hash = ? or (previous_session_hash = ? and previous_valid_until > ?))
      and revoked_at is null and expires_at > ? and absolute_expires_at > ?
    limit 1
  `).bind(sessionHash, sessionHash, now, now, now).first();
  return normalizeSession(row);
}

export async function rotateSession(env, previousHash, nextHash, expiresAt) {
  const now = new Date();
  const result = await authDb(env).prepare(`
    update business_sessions
    set previous_session_hash = session_hash,
        previous_valid_until = ?,
        session_hash = ?,
        last_seen_at = ?,
        expires_at = min(?, absolute_expires_at)
    where session_hash = ? and revoked_at is null and expires_at > ? and absolute_expires_at > ?
  `).bind(
    new Date(now.getTime() + 60000).toISOString(),
    nextHash,
    now.toISOString(),
    expiresAt,
    previousHash,
    now.toISOString(),
    now.toISOString()
  ).run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function revokeSession(env, sessionHash) {
  const now = new Date().toISOString();
  await authDb(env).prepare(`
    update business_sessions set revoked_at = ?
    where (session_hash = ? or (previous_session_hash = ? and previous_valid_until > ?))
      and revoked_at is null
  `).bind(now, sessionHash, sessionHash, now).run();
}
