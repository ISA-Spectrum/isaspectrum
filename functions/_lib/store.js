import * as d1 from './store-d1.js';
import * as supabase from './store-supabase.js';
function store(env) {
  const name = env.AUTH_STORE || 'd1';
  if (name === 'supabase') return supabase;
  if (name === 'd1') return d1;
  throw new Error('invalid_config:AUTH_STORE');
}
export const createTransaction = (env, ...args) => store(env).createTransaction(env, ...args);
export const pruneAuthState = (env, ...args) => store(env).pruneAuthState(env, ...args);
export const consumeTransaction = (env, ...args) => store(env).consumeTransaction(env, ...args);
export const createSession = (env, ...args) => store(env).createSession(env, ...args);
export const readSession = (env, ...args) => store(env).readSession(env, ...args);
export const rotateSession = (env, ...args) => store(env).rotateSession(env, ...args);
export const revokeSession = (env, ...args) => store(env).revokeSession(env, ...args);
