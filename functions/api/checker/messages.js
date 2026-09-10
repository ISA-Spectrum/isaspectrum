import { authenticateApi, cleanText, integerParam } from '../../_lib/api.js';
import { json, methodNotAllowed } from '../../_lib/http.js';
import { requestStore } from '../../_lib/store.js';

const STATUSES = { pending: 0, approved: 1, deleted: 2 };
const ACTIONS = new Set(['approve', 'reject', 'delete', 'restore']);

async function requireChecker(request, env) {
  return authenticateApi(request, env, { checker: true });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireChecker(request, env);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  if (!(status in STATUSES)) return json({ error: 'invalid_status' }, 400, auth.headers);
  const page = integerParam(url.searchParams.get('page'), 0, 0, 10000);
  const limit = integerParam(url.searchParams.get('limit'), 50, 1, 100);
  const params = new URLSearchParams({
    flag: `eq.${STATUSES[status]}`,
    select: 'id,username,content,zone,pic_url,created_at,reply_to,contact_email,reject_reason',
    order: 'created_at.desc',
    offset: String(page * limit),
    limit: String(limit + 1)
  });
  try {
    const rows = await requestStore(env, `messages?${params}`);
    return json({ messages: rows.slice(0, limit), hasMore: rows.length > limit }, 200, auth.headers);
  } catch {
    return json({ error: 'moderation_unavailable' }, 503, auth.headers);
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireChecker(request, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, auth.headers); }
  const id = String(body.id || '');
  const action = String(body.action || '');
  const reason = cleanText(body.reason, 1000);
  if (!/^\d+$/.test(id) || !ACTIONS.has(action) || (['reject', 'delete'].includes(action) && !reason)) {
    return json({ error: 'invalid_request' }, 400, auth.headers);
  }
  try {
    const rows = await requestStore(env, 'rpc/moderate_business_message', {
      method: 'POST',
      body: JSON.stringify({
        p_message_id: Number(id),
        p_operator_user_id: auth.session.user_id,
        p_action: action,
        p_reason: reason || null
      })
    });
    const targetUserId = rows?.[0]?.business_user_id;
    if (targetUserId) {
      const copy = {
        approve: ['留言审核通过', '你的留言、评论或回复已审核通过并公开显示'],
        reject: ['留言未通过审核', `拒绝原因：${reason}`],
        delete: ['留言已被删除', `删除原因：${reason}`],
        restore: ['留言已恢复', '你的留言已恢复并重新公开显示']
      }[action];
      try {
        await requestStore(env, 'business_notifications', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: targetUserId, title: copy[0], content: copy[1], type: 'audit', related_id: Number(id) })
        });
      } catch {}
    }
    return json({ ok: true }, 200, auth.headers);
  } catch {
    return json({ error: 'moderation_conflict' }, 409, auth.headers);
  }
}

export function onRequest() {
  return methodNotAllowed('GET, PATCH');
}
