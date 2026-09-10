import { authenticateApi, cleanText, shanghaiDate } from '../_lib/api.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { requestStore } from '../_lib/store.js';

export async function onRequestGet({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  const date = shanghaiDate();
  try {
    const rows = await requestStore(env,
      `meal_ratings?business_user_id=eq.${encodeURIComponent(auth.session.user_id)}&rating_date=eq.${date}&select=breakfast_score,lunch_score,dinner_score,comment,updated_at&limit=1`
    );
    return json({ date, rating: rows?.[0] || null }, 200, auth.headers);
  } catch {
    return json({ error: 'meal_rating_unavailable' }, 503, auth.headers);
  }
}

export async function onRequestPut({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, auth.headers); }
  const scores = ['breakfastScore', 'lunchScore', 'dinnerScore'].map(key => Number(body[key]));
  if (scores.some(score => !Number.isInteger(score) || score < 1 || score > 5)) {
    return json({ error: 'invalid_scores' }, 400, auth.headers);
  }
  const rawComment = String(body.comment ?? '');
  if (rawComment.length > 500) return json({ error: 'comment_too_long' }, 400, auth.headers);
  const displayName = cleanText(auth.session.display_name || auth.session.email?.split('@')[0] || '校园用户', 80);
  const date = shanghaiDate();
  try {
    const rows = await requestStore(env, 'meal_ratings?on_conflict=business_user_id,rating_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        business_user_id: auth.session.user_id,
        user_id: null,
        display_name: displayName,
        rating_date: date,
        breakfast_score: scores[0],
        lunch_score: scores[1],
        dinner_score: scores[2],
        comment: cleanText(rawComment, 500) || null,
        updated_at: new Date().toISOString()
      })
    });
    return json({ ok: true, date, rating: rows?.[0] || null }, 200, auth.headers);
  } catch {
    return json({ error: 'meal_rating_save_failed' }, 503, auth.headers);
  }
}

export function onRequest() {
  return methodNotAllowed('GET, PUT');
}
