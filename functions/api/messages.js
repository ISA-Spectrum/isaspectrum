import { authenticateApi, cleanText, integerParam } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { loadLexicon, scanLexicon } from '../_lib/lexicon.js';
import { requestBusinessData, requestPublicData } from '../_lib/supabase.js';

const ZONES = new Set(['校园生活', '学习互助', '活动社团', '失物招领']);
const MESSAGE_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const NVAPI_MODEL = 'nvidia/nemotron-3.5-content-safety';
const NVAPI_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVAPI_TIMEOUT_MS = 15000;
const NVAPI_MAX_ATTEMPTS = 2;

/** KV统计，故障不影响业务 */
async function getTodayAiCounter(env) {
  try {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const kvKey = `ai_check:${todayUtc}`;
    const raw = await env.AI_COUNTER_KV.get(kvKey);
    const count = Number(raw) || 0;
    return { kvKey, count };
  } catch {
    return { kvKey: '', count: 0 };
  }
}

/** KV 计数 +1，失败静默 */
async function bumpCounter(env, key, expirationTtl = 86400) {
  if (!key) return;
  try {
    const raw = await env.AI_COUNTER_KV.get(key);
    await env.AI_COUNTER_KV.put(key, String((Number(raw) || 0) + 1), { expirationTtl });
  } catch {}
}

/**
 * 解析 NIM 输出。只认最后一次出现的判定，避免推理文本里的字样干扰。
 */
function verdictFromText(outText) {
  if (!outText) return { verdict: 'uncertain', reason: 'empty_output' };
  const matches = [...outText.matchAll(/user safety:\s*(safe|unsafe)/gi)];
  const last = matches.length ? matches[matches.length - 1][1].toLowerCase() : '';
  if (last === 'safe') return { verdict: 'safe', reason: 'model_safe' };
  if (last === 'unsafe') return { verdict: 'blocked', reason: 'model_unsafe' };
  return { verdict: 'uncertain', reason: 'unparsed_output' };
}

/**
 * 两级审核
 *   L1 本地词库：零网络开销，命中即阻断转人工（含图片的留言同样执行）
 *   L2 NVIDIA nemotron-3.5-content-safety：仅纯文本，明确输出 safe 才通过
 *
 * 返回 { verdict, reason, hits }
 *   verdict: 'safe' | 'blocked' | 'uncertain' | 'timeout' | 'error'
 *   reason : 'lexicon' | 'model_safe' | 'model_unsafe' | 'image' | ...
 * 仅 verdict === 'safe' 时放行，其余一律 flag=0 转人工。
 */
async function runAiCheck(contentText, imageUrls, env) {
  // ---- L1 词库 ----
  const lex = await loadLexicon(env);
  const scan = scanLexicon(contentText, lex);
  if (scan.hit) {
    console.log(`[AI Check] 词库命中 ${scan.words.length} 条，转人工`);
    return { verdict: 'blocked', reason: 'lexicon', hits: scan.words };
  }

  // ---- L2 NIM ----
  // 有图片直接跳过API，转入人工
  if (imageUrls && imageUrls.length > 0) {
    console.log('[AI Check] 留言包含图片，跳过AI自动审核，转入人工');
    return { verdict: 'uncertain', reason: 'image' };
  }

  const nvApiKey = env.NVAPI_KEY;
  if (!nvApiKey) {
    console.error('[AI Check] NVAPI_KEY 环境变量缺失');
    return { verdict: 'error', reason: 'missing_key' };
  }

  const payload = {
    model: NVAPI_MODEL,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: contentText }]
      }
    ],
    max_tokens: 100,
    temperature: 0.01,
    top_p: 0.95,
    chat_template_kwargs: {
      request_categories: '/no_categories',
      enable_thinking: false
    }
  };

  const headers = {
    Authorization: `Bearer ${nvApiKey}`,
    'Content-Type': 'application/json'
  };

  console.log(`[AI Check] 请求 NIM，文本长度 ${contentText.length}`);

  for (let attempt = 1; attempt <= NVAPI_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NVAPI_TIMEOUT_MS);
    let retryable = false;

    try {
      const resp = await fetch(NVAPI_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (resp.ok) {
        const apiResult = await resp.json();
        const outText = apiResult.choices?.[0]?.message?.content?.trim() ?? '';
        console.log(`[AI Check] 判定结果: ${outText.replace(/\s+/g, ' ').slice(0, 200)}`);
        return verdictFromText(outText);
      }

      const errText = await resp.text().catch(() => '');
      if (resp.status === 429 || resp.status >= 500) {
        console.error(`[AI Check] 可重试状态 ${resp.status}：`, errText.slice(0, 300));
        retryable = true;
      } else {
        console.error(`[AI Check] 非重试错误 ${resp.status}：`, errText.slice(0, 300));
        return { verdict: 'error', reason: `http_${resp.status}` };
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        console.error(`[AI Check] 请求超时 > ${NVAPI_TIMEOUT_MS}ms`);
      } else {
        console.error('[AI Check] 请求异常：', e?.message);
      }
      retryable = true;
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
    }

    if (retryable && attempt < NVAPI_MAX_ATTEMPTS) {
      const backoff = 500 * attempt;
      console.log(`[AI Check] ${backoff}ms 后重试（第 ${attempt + 1} 次）`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    return { verdict: 'uncertain', reason: 'upstream_unavailable' };
  }

  return { verdict: 'uncertain', reason: 'upstream_unavailable' };
}

async function listMessages(request, env) {
  const url = new URL(request.url);
  const thread = url.searchParams.get('thread')?.toLowerCase();
  const params = new URLSearchParams({
    select: 'id,username,content,zone,pic_url,created_at,reply_to,avatar_url'
  });

  if (thread) {
    if (!MESSAGE_ID.test(thread)) return json({ error: 'invalid_request' }, 400);
    const page = integerParam(url.searchParams.get('thread_page'), 0, 0, 100000);
    const limit = 100;
    params.set('p_root_id', thread);
    params.set('order', 'created_at.asc,id.asc');
    params.set('limit', String(limit + 1));
    params.set('offset', String(page * limit));
    const rows = await requestPublicData(env, `rpc/approved_message_thread?${params}`);
    if (page === 0 && !rows.length) return json({ error: 'not_found' }, 404);
    return json({ messages: rows.slice(0, limit), hasMore: rows.length > limit });
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
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return null;
    result.push(url.toString());
  }
  return result;
}

async function createMessage(request, env) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400, auth.headers);
  }

  const content = cleanText(body.content, 1000);
  const zone = ZONES.has(body.zone) ? body.zone : '校园生活';
  const replyTo = body.replyTo == null ? null : String(body.replyTo);
  const imageUrls = validateImageUrls(env, body.imageUrls || [], auth.session.user_id);

  if (!content || (replyTo !== null && !MESSAGE_ID.test(replyTo)) || imageUrls === null) {
    return json({ error: 'invalid_request' }, 400, auth.headers);
  }

  const displayName = cleanText(
    auth.session.display_name || auth.session.email?.split('@')[0] || '校园用户',
    80
  );
  const username = body.anonymous === true ? '匿名用户' : displayName;

  if (replyTo) {
    const target = await requestPublicData(
      env,
      `approved_messages_public?id=eq.${encodeURIComponent(replyTo)}&select=id&limit=1`
    );
    if (!target.length) return json({ error: 'reply_target_not_found' }, 404, auth.headers);
  }

  // ========= AI 逻辑 =========
  let flag = 0;
  const { kvKey, count } = await getTodayAiCounter(env);

  const aiRes = await runAiCheck(content, imageUrls, env);
  if (aiRes.verdict === 'safe') {
    flag = 1;
  }
  console.log(`[AI Check] 结论: ${aiRes.verdict} / ${aiRes.reason}`);

  if (kvKey) {
    await bumpCounter(env, kvKey);
    if (aiRes.reason === 'lexicon') {
      await bumpCounter(env, kvKey.replace('ai_check:', 'lexicon_hit:'));
    }
  }
  // 命中词条本身不落库、不入日志，避免二次泄露
  // ===========================

  try {
    const rows = await requestBusinessData(env, auth.session, 'messages?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
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
  try {
    return await listMessages(request, env);
  } catch {
    return json({ error: 'messages_unavailable' }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  return createMessage(request, env);
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
