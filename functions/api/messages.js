import { authenticateApi, cleanText, integerParam } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestBusinessData, requestPublicData } from '../_lib/supabase.js';

const ZONES = new Set(['校园生活', '学习互助', '活动社团', '失物招领']);
const MESSAGE_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const NVAPI_MODEL = "nvidia/nemotron-4-guardrails";
const NVAPI_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

/** KV统计，故障不影响业务 */
async function getTodayAiCounter(env) {
    try {
        const todayUtc = new Date().toUTCString().slice(0, 10);
        const kvKey = `ai_check:${todayUtc}`;
        const raw = await env.AI_COUNTER_KV.get(kvKey);
        const count = Number(raw) || 0;
        return { kvKey, count };
    } catch {
        return { kvKey: "", count: 0 };
    }
}

/** AI审核：5s超时，429最多重试1次 */
async function runAiCheck(content, imageUrls, env) {
    const nvApiKey = env.NVAPI_KEY;
    if (!nvApiKey) return "error";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const multiContent = [{ type: "text", text: content }];
        for (const imgUrl of imageUrls) {
            multiContent.push({ type: "image_url", image_url: { url: imgUrl } });
        }

        const payload = {
            model: NVAPI_MODEL,
            messages: [{ role: "user", content: multiContent }]
        };
        const headers = {
            "Authorization": `Bearer ${nvApiKey}`,
            "Content-Type": "application/json"
        };

        let retries = 1;
        while(retries >= 0) {
            const resp = await fetch(NVAPI_ENDPOINT, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if(resp.status === 429) {
                retries--;
                if(retries >= 0) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                } else {
                    return "uncertain";
                }
            }
            if(!resp.ok) return "uncertain";
            const data = await resp.json();
            const out = data.choices?.[0]?.message?.content?.trim() ?? "";
            return out.toLowerCase() === "safe" ? "safe" : "uncertain";
        }
        return "uncertain";
    } catch(e) {
        if(e.name === "AbortError") return "timeout";
        return "error";
    } finally {
        clearTimeout(timeoutId);
    }
}

async function listMessages(request, env) {
  const url = new URL(request.url);
  const thread = url.searchParams.get('thread');
  const params = new URLSearchParams({
    select: 'id,username,content,zone,pic_url,created_at,reply_to,avatar_url'
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

  if (replyTo) {
    const target = await requestPublicData(env, `approved_messages_public?id=eq.${encodeURIComponent(replyTo)}&select=id&limit=1`);
    if (!target.length) return json({ error: 'reply_target_not_found' }, 404, auth.headers);
  }

  // ========= AI 逻辑（完全复用原版auth.session） =========
  let flag = 0;
  const { kvKey, count } = await getTodayAiCounter(env);

  if(env.NVAPI_KEY) {
      const aiRes = await runAiCheck(content, imageUrls, env);
      if(aiRes === "safe") {
          flag = 1;
      }
      // KV统计，吞掉异常
      if(kvKey) {
          try {
              await env.AI_COUNTER_KV.put(kvKey, String(count+1), { expirationTtl:86400 });
          }catch {}
      }
  }
  // =======================================================

  try {
    const rows = await requestBusinessData(env, auth.session, 'messages?select=id', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        business_user_id: auth.session.user_id,
        username,
        content,
        zone,
        pic_url: imageUrls.length ? imageUrls : null,
        contact_email: auth.session.email || null,
        flag: flag,
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
