import { getConfig } from '../_lib/config.js';
import { json, methodNotAllowed, sameOriginRequest, safeReturnPath } from '../_lib/http.js';
import { discover } from '../_lib/oidc.js';
import { destroyBusinessSession, getBusinessSession } from '../_lib/session.js';

async function providerLogoutUrl(env, rawIdToken) {
  try {
    const config = getConfig(env);
    const discovery = await discover(config);
    if (!discovery.end_session_endpoint) return null;

    const url = new URL(discovery.end_session_endpoint);
    url.searchParams.set('client_id', config.clientId);
    if (config.postLogoutRedirect) {
      url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirect);
    }
    if(rawIdToken) {
      url.searchParams.set('id_token_hint', rawIdToken);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return json({ error: 'invalid_origin' }, 403);

  let session, cookie;
  try {
    const config = getConfig(env);
    ({ session } = await getBusinessSession(request, env, config));
    cookie = await destroyBusinessSession(request, env, true);
  } catch {
    return json({ error: 'session_unavailable' }, 503);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const idpLogoutUrl = await providerLogoutUrl(env, session?.id_token_raw);
  return json({ idpLogoutUrl, returnTo: safeReturnPath(body?.returnTo) }, 200, { 'Set-Cookie': cookie });
}

export function onRequest() {
  return methodNotAllowed('POST');
}
