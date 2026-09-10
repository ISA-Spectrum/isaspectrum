import { authenticateApi, cleanText, integerParam } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestStore } from '../_lib/store.js';

const ZONES = new Set(['校园生活', '学习互助', '活动社团', '失物招领']);

function inFilter(values) {
  return `in.(${values.map(value => `"${String(value).replace(/"/g, '')}"`).join(',')})`;
}

async function decorateMessages(env, rows) {
  const legacyIds = [...new Set(rows.filter(row => row.username !== '匿名用户' && row.user_id).map(row => row.user_id))];
  const businessIds = [...new Set(rows.filter(row => row.username !== '匿名用户' && row.business_user_id).map(row => row.business_user_id))];
  const avatars = new Map();
  if (legacyIds.length) {
    try {
      const profiles = await requestStore(env, `profiles?user_id=${encodeURIComponent(inFilter(legacyIds))}&select=user_id,avatar_url`);
      profiles.forEach(profile => avatars.set(`legacy:${profile.user_id}`, profile.avatar_url));
    } catch {}
  }
  if (businessIds.length) {
    const users = await requestStore(env, `business_users?user_id=${encodeURIComponent(inFilter(businessIds))}&select=user_id,avatar_url`);
    users.forEach(user => avatars.set(`business:${user.user_id}`, user.avatar_url));
  }
  const avatarUrl = value => {
    if (!value) return null;
    try {
      const url = new URL(value);
      const businessOrigin = new URL(String(env.BUSINESS_SUPABASE_URL)).origin;
      return url.origin === businessOrigin && url.pathname.startsWith('/storage/v1/object/public/avatars/')
        ? url.toString()
        : null;
    } catch { return null; }
  };
  return rows.map(row => ({
    id: row.id,
    username: row.username,
    content: row.content,
    zone: row.zone,
    pic_url: row.pic_url,
    created_at: row.created_at,
    reply_to: row.reply_to,
    avatar_url: row.username === '匿名用户' ? null : avatarUrl(
      avatars.get(`business:${row.business_user_id}`) || avatars.get(`legacy:${row.user_id}`)
    )
  }));
}

async function listMessages(request, env) {
  const url = new URL(request.url);
  const thread = url.searchParams.get('thread');
  const params = new URLSearchParams({
    select: 'id,user_id,business_user_id,username,content,zone,pic_url,created_at,reply_to',
    flag: 'eq.1'
  });
  if (thread) {
    if (!/^\d+$/.test(thread)) return json({ error: 'invalid_request' }, 400);
    params.set('order', 'created_at.asc');
    params.set('limit', '1000');
    const all = await requestStore(env, `messages?${params}`);
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
    return json({ messages: await decorateMessages(env, result) });
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
  const rows = await requestStore(env, `messages?${params}`);
  const hasMore = rows.length > limit;
  return json({ messages: await decorateMessages(env, rows.slice(0, limit)), hasMore, page });
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
  if (!content || (replyTo !== null && !/^\d+$/.test(replyTo)) || imageUrls === null) {
    return json({ error: 'invalid_request' }, 400, auth.headers);
  }
  const displayName = cleanText(auth.session.display_name || auth.session.email?.split('@')[0] || '校园用户', 80);
  const username = body.anonymous === true ? '匿名用户' : displayName;
  try {
    let replyTarget = null;
    if (replyTo) {
      const target = await requestStore(env, `messages?id=eq.${encodeURIComponent(replyTo)}&flag=eq.1&select=id,business_user_id&limit=1`);
      if (!target.length) return json({ error: 'reply_target_not_found' }, 404, auth.headers);
      replyTarget = target[0];
    }
    const rows = await requestStore(env, 'messages?select=id', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: null,
        business_user_id: auth.session.user_id,
        username,
        content,
        zone,
        pic_url: imageUrls.length ? imageUrls : null,
        contact_email: auth.session.email || null,
        flag: 0,
        reply_to: replyTo ? Number(replyTo) : null
      })
    });
    const messageId = rows[0].id;
    const checkers = await requestStore(env, 'business_users?is_checker=eq.true&select=user_id');
    if (checkers.length) {
      await requestStore(env, 'business_notifications', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(checkers.map(checker => ({
          user_id: checker.user_id,
          title: '新留言待审核',
          content: `用户：${username}\n内容：${content.slice(0, 80)}`,
          type: 'audit',
          related_id: messageId
        })))
      });
    }
    if (replyTo) {
      const targetUserId = replyTarget?.business_user_id;
      if (targetUserId && targetUserId !== auth.session.user_id) {
        await requestStore(env, 'business_notifications', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: targetUserId,
            title: `${username} 回复了你`,
            content: content.slice(0, 160),
            type: 'reply',
            related_id: messageId
          })
        });
      }
    }
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
