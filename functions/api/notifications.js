import { authenticateApi, integerParam } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestBusinessData } from '../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const page = integerParam(url.searchParams.get('page'), 0, 0, 10000);
  const limit = integerParam(url.searchParams.get('limit'), 10, 1, 50);
  const unreadOnly = url.searchParams.get('unread') === '1';
  const params = new URLSearchParams({
    user_id: `eq.${auth.session.user_id}`,
    select: 'id,title,content,type,related_id,read,created_at',
    order: 'created_at.desc',
    offset: String(page * limit),
    limit: String(limit + 1)
  });
  if (unreadOnly) params.set('read', 'eq.false');
  try {
    const rows = await requestBusinessData(env, auth.session, `business_notifications?${params}`);
    return json({ notifications: rows.slice(0, limit), hasMore: rows.length > limit }, 200, auth.headers);
  } catch { return json({ error: 'notifications_unavailable' }, 503, auth.headers); }
}

export async function onRequestPatch({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  try {
    await requestBusinessData(env, auth.session, `business_notifications?user_id=eq.${encodeURIComponent(auth.session.user_id)}&read=eq.false`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ read: true })
    });
    return json({ ok: true }, 200, auth.headers);
  } catch { return json({ error: 'notifications_update_failed' }, 503, auth.headers); }
}

export function onRequest() {
  return methodNotAllowed('GET, PATCH');
}
