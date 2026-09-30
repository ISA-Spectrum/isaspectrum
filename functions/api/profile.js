import { authenticateApi } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestBusinessData } from '../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  try {
    const rows = await requestBusinessData(env, auth.session, `business_users?user_id=eq.${encodeURIComponent(auth.session.user_id)}&select=avatar_url&limit=1`);
    return json({ avatarUrl: rows[0]?.avatar_url || null }, 200, auth.headers);
  } catch { return json({ error: 'profile_unavailable' }, 503, auth.headers); }
}

export async function onRequestPut({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, auth.headers); }
  let avatar;
  try { avatar = new URL(body.avatarUrl); } catch { return json({ error: 'invalid_avatar' }, 400, auth.headers); }
  const base = new URL(String(env.BUSINESS_SUPABASE_URL));
  const requiredPrefix = `/storage/v1/object/public/avatars/business/${auth.session.user_id}.`;
  if (avatar.origin !== base.origin || !avatar.pathname.startsWith(requiredPrefix)) return json({ error: 'invalid_avatar' }, 400, auth.headers);
  try {
    await requestBusinessData(env, auth.session, `business_users?user_id=eq.${encodeURIComponent(auth.session.user_id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ avatar_url: avatar.toString() })
    });
    return json({ ok: true, avatarUrl: avatar.toString() }, 200, auth.headers);
  } catch { return json({ error: 'profile_save_failed' }, 503, auth.headers); }
}

export function onRequest() {
  return methodNotAllowed('GET, PUT');
}
