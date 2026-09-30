import { cookieNames, json, methodNotAllowed, redirect, sameOriginRequest, safeReturnPath } from '../_lib/http.js';
import { destroyBusinessSession } from '../_lib/session.js';

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return json({ error: 'invalid_origin' }, 403);
  const clearSession = await destroyBusinessSession(request, env);
  const contentType = request.headers.get('Content-Type') || '';
  let returnTo = '/main.html';
  if (contentType.includes('application/json')) {
    try { returnTo = safeReturnPath((await request.json()).returnTo, '/main.html'); } catch {}
  } else if (contentType.includes('form')) {
    try { returnTo = safeReturnPath((await request.formData()).get('return_to'), '/main.html'); } catch {}
  }
  if ((request.headers.get('Accept') || '').includes('application/json')) {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSession });
  }
  return redirect(returnTo, 303, { 'Set-Cookie': clearSession });
}

export function onRequest() {
  return methodNotAllowed('POST');
}
