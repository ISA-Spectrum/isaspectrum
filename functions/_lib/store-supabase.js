import { withDeadline } from './fetch-timeout.js';
// Server-only shared session store. Never use a browser publishable key here.
async function call(env, operation, args = {}) {
  const url = String(env.BUSINESS_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.AUTH_STORE_SUPABASE_SECRET_KEY || '').trim();
  if (!url.startsWith('https://') || !key) throw new Error('auth_store_not_configured');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy service_role JWTs require Authorization; sb_secret keys use apikey.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return withDeadline(async signal => {
    const response = await fetch(`${url}/rest/v1/rpc/isa_auth_store`, {
      method: 'POST', headers, signal, body: JSON.stringify({ operation, args })
  });
  if (!response.ok) throw new Error(`auth_store_unavailable:${response.status}`);
  return response.json();
  });
}
export const createTransaction = (env, value) => call(env, 'create_transaction', value);
export const pruneAuthState = env => call(env, 'prune');
export const consumeTransaction = (env, state, binding) => call(env, 'consume_transaction', { state, binding });
export const createSession = (env, value) => call(env, 'create_session', value);
export const readSession = (env, hash) => call(env, 'read_session', { hash });
export const rotateSession = (env, previous, next, expires) => call(env, 'rotate_session', { previous, next, expires });
export const revokeSession = (env, hash) => call(env, 'revoke_session', { hash });
