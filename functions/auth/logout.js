import { getConfig } from '../_lib/config.js';
import { cookieNames, json, methodNotAllowed, redirect, sameOriginRequest, safeReturnPath } from '../_lib/http.js';
import { discover } from '../_lib/oidc.js';
import { destroyBusinessSession } from '../_lib/session.js';

// Clearing our own cookie is not enough. The authorization server keeps its own SSO
// session, so the next "login" silently re-authenticates the same account without asking
// for a password — on a shared computer that reads as "logout did nothing". RP-initiated
// logout ends that session too.
async function providerLogoutUrl(env) {
  try {
    const config = getConfig(env);
    const discovery = await discover(config);
    if (!discovery.end_session_endpoint) return null;
    const url = new URL(discovery.end_session_endpoint);
    url.searchParams.set('client_id', config.clientId);
    if (config.postLogoutRedirect) url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirect);
    return url.toString();
  } catch {
    // The local logout must still succeed while the provider is unreachable.
    return null;
  }
}

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
  const idpLogoutUrl = await providerLogoutUrl(env);
  if ((request.headers.get('Accept') || '').includes('application/json')) {
    return json({ ok: true, idpLogoutUrl, returnTo }, 200, { 'Set-Cookie': clearSession });
  }
  return redirect(idpLogoutUrl || returnTo, 303, { 'Set-Cookie': clearSession });
}

export function onRequest() {
  return methodNotAllowed('POST');
}
