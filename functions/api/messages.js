import { authenticateApi, cleanText, integerParam } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestBusinessData, requestPublicData } from '../_lib/supabase.js';

const ZONES = new Set(['校园生活', '学习互助', '活动社团', '失物招领']);
const MESSAGE_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const NVAPI_MODEL = "nvidia/nemotron-4-guardrails";
const NVAPI_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

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

async function runAiCheck(content, imageUrls, env) {
    const nvApiKey = env.NVAPI_KEY;
    if (!nvApiKey) return "error";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const headers = {
        "Authorization": `Bearer ${nvApiKey}`,
        "Content-Type": "application/json"
    };

    let messagesContent = [];
    messagesContent.push({ type: "text", text: content });
    for (const url of imageUrls) {
        messagesContent.push({ type: "image_url", image_url: { url } });
    }

    const payload = {
        model: NVAPI_MODEL,
        messages: [{ role: "user", content: messagesContent }]
    };

    let retries = 1;
    while (retries >= 0) {
        try {
            const res = await fetch(NVAPI_ENDPOINT, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (res.status === 429) {
                retries--;
                if (retries >= 0) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                } else {
                    return "uncertain";
                }
            }
            if (!res.ok) return "uncertain";
            const data = await res.json();
            const output = data.choices?.[0]?.message?.content?.trim() ?? "";
            return output.toLowerCase() === "safe" ? "safe" : "uncertain";
        } catch (e) {
            if (e.name === "AbortError") return "timeout";
            return "error";
        }
    }
    clearTimeout(timeoutId);
    return "uncertain";
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
        const all = await requestPublicData(`messages?${params.toString()}`);
        const map = new Map();
        const roots = [];
        for (const msg of all) {
            map.set(msg.id, msg);
            if (msg.reply_to === null) roots.push(msg);
        }
        function walk(parentId) {
            const children = all.filter(m => m.reply_to === parentId);
            let out = [];
            for (const c of children) {
                out.push(c, ...walk(c.id));
            }
            return out;
        }
        const rootMsg = map.get(thread);
        if (!rootMsg) return json({ error: 'not_found' }, 404);
        return json({ messages: [rootMsg, ...walk(thread)] });
    }
    const page = parseInt(url.searchParams.get('page') || '0');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    const zone = url.searchParams.get('zone');
    const q = url.searchParams.get('q');
    params.set('reply_to', 'is.null');
    params.set('order', `created_at.${url.searchParams.get('sort') === 'oldest' ? 'asc' : 'desc'}`);
    params.set('offset', String(page * limit));
    params.set('limit', String(limit + 1));
    if (zone) params.append('zone', `eq.${zone}`);
    if (q) params.append('content', `ilike.%${q.replace(/[,]/g, '')}%`);
    const rows = await requestPublicData(`messages?${params.toString()}`);
    const hasMore = rows.length > limit;
    return json({ messages: rows.slice(0, limit), hasMore });
}

function validateImageUrls(env, values, userId) {
    if (!Array.isArray(values) || values.length > 5) return null;
    const baseUrl = new URL(env.BUSINESS_SUPABASE_URL);
    const prefix = `/storage/v1/object/public/message-pics/business/${userId}/`;
    const out = [];
    for (const u of values) {
        try {
            const parsed = new URL(u);
            if (parsed.origin !== baseUrl.origin || !parsed.pathname.startsWith(prefix)) return null;
            out.push(u);
        } catch {
            return null;
        }
    }
    return out;
}

export async function onRequestPost({ request, env }) {
    const auth = await authenticateApi(request, env);
    if (auth.error) return json({ error: auth.error }, auth.status);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const content = cleanText(body.content || "", 1000);
    const zone = ZONES.has(body.zone) ? body.zone : '校园生活';
    const replyTo = body.replyTo ?? null;
    const imageUrls = validateImageUrls(env, body.imageUrls || [], auth.userId);
    if (!content || (replyTo && !MESSAGE_ID.test(replyTo)) || imageUrls === null) {
        return json({ error: 'invalid_payload' }, 400);
    }
    const username = body.anonymous ? '匿名用户' : cleanText(auth.displayName || auth.email.split('@')[0], 80);

    if (replyTo) {
        const check = await requestPublicData(`messages?id=eq.${replyTo}&select=id&limit=1`);
        if (!check.length) return json({ error: 'reply_target_not_found' }, 404);
    }

    let flag = 0;
    const { kvKey, count } = await getTodayAiCounter(env);
    if (env.NVAPI_KEY) {
        const res = await runAiCheck(content, imageUrls, env);
        if (res === "safe") flag = 1;
        if (kvKey) {
            try {
                await env.AI_COUNTER_KV.put(kvKey, String(count + 1), { expirationTtl: 86400 });
            } catch { /* ignore kv write fail */ }
        }
    }

    const payload = {
        business_user_id: auth.userId,
        username,
        content,
        zone,
        pic_url: imageUrls.length ? imageUrls : null,
        contact_email: auth.email,
        flag,
        reply_to: replyTo
    };
    try {
        const [row] = await requestBusinessData('messages', 'POST', payload);
        return json({ ok: true, id: row.id }, 201);
    } catch {
        return json({ error: 'db_write_fail' }, 503);
    }
}

export async function onRequestGet({ request, env }) {
    try {
        const data = await listMessages(request, env);
        return json(data);
    } catch {
        return json({ error: 'server_error' }, 503);
    }
}

export function onRequest() {
    return methodNotAllowed();
}
