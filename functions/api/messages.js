import { authenticateApi, cleanText, integerParam } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestBusinessData, requestPublicData } from '../_lib/supabase.js';

const ZONES = new Set(['校园生活', '学习互助', '活动社团', '失物招领']);
const MESSAGE_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

async function listMessages(request, env) {
  const url = new URL(request.url);
  const thread = url.searchParams.get('thread');
  const params = new URLSearchParams({
    select: 'id,username,content,zone,pic_url,created_at,reply_to'
  });
  if (thread) {
    if (!MESSAGE_ID.test(thread)) return json({ error: 'invalid_request' }, 400);
    params.set('order', 'created_at.asc');
    params.set('limit', '1000');
    const all = await requestPublicData(env, `approved_messages_public?${params}`);
    const byParent = new Map();
    all.forEach(message => {
      const key = message.reply_to == null ? null : String(message.reply_to);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(message);
    });
    const root = all.find(message => String(message.id) === thread && message.reply_to == null);
    if (!root) return json({ error: 'not_found' }, 404);
    const result = [root];
    const visit = parentId => {
      for (const child of byParent.get(String(parentId)) || []) {
        result.push(child);
        visit(child.id);
      }
    };
    visit(root.id);
    return json({ messages: result });
  }

  const page = integerParam(url.searchParams.get('page'), 0, 0, 100000);
  const limit = integerParam(url.searchParams.get('limit'), 20, 1, 50);
  const zone = url.searchParams.get('zone');
  const search = cleanText(url.searchParams.get('search'), 100);
  params.set('reply_to', 'is.null');
  params.set('order', `created_at.${url.searchParams.get('sort') === 'oldest' ? 'asc' : 'desc'}`);
  params.set('offset', String(page * limit));
  params.set('limit', String(limit + 1));
  if (zone && zone !== 'all' && ZONES.has(zone)) params.set('zone', `eq.${zone}`);
  if (search) params.set('content', `ilike.*${search.replace(/[,*()]/g, ' ')}*`);
  const rows = await requestPublicData(env, `approved_messages_public?${params}`);
  const hasMore = rows.length > limit;
  return json({ messages: rows.slice(0, limit), hasMore, page });
}

function validateImageUrls(env, values, userId) {
  if (!Array.isArray(values) || values.length > 5) return null;
  const base = new URL(String(env.BUSINESS_SUPABASE_URL));
  const prefix = `/storage/v1/object/public/message-pics/business/${userId}/`;
  const result = [];
  for (const value of values) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return null;
    result.push(url.toString());
  }
  return result;
}

async function createMessage(request, env) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, auth.headers); }
  const content = cleanText(body.content, 1000);
  const zone = ZONES.has(body.zone) ? body.zone : '校园生活';
  const replyTo = body.replyTo == null ? null : String(body.replyTo);
  const imageUrls = validateImageUrls(env, body.imageUrls || [], auth.session.user_id);
  if (!content || (replyTo !== null && !MESSAGE_ID.test(replyTo)) || imageUrls === null) {
    return json({ error: 'invalid_request' }, 400, auth.headers);
  }
  const displayName = cleanText(auth.session.display_name || auth.session.email?.split('@')[0] || '校园用户', 80);
  const username = body.anonymous === true ? '匿名用户' : displayName;
  try {
    if (replyTo) {
      const target = await requestPublicData(env, `approved_messages_public?id=eq.${encodeURIComponent(replyTo)}&select=id&limit=1`);
      if (!target.length) return json({ error: 'reply_target_not_found' }, 404, auth.headers);
    }
    const rows = await requestBusinessData(env, auth.session, 'messages?select=id', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        business_user_id: auth.session.user_id,
        username,
        content,
        zone,
        pic_url: imageUrls.length ? imageUrls : null,
        contact_email: auth.session.email || null,
        flag: 0,
        reply_to: replyTo || null
      })
    });
    const messageId = rows[0].id;
    return json({ ok: true, id: messageId }, 201, auth.headers);
  } catch {
    return json({ error: 'message_save_failed' }, 503, auth.headers);
  }
}

export async function onRequestGet({ request, env }) {
  try { return await listMessages(request, env); } catch { return json({ error: 'messages_unavailable' }, 503); }
}

export async function onRequestPost({ request, env }) {
  return createMessage(request, env);
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
