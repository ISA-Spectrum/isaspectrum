import { getConfig } from '../_lib/config.js';
import { methodNotAllowed, redirect } from '../_lib/http.js';
import { discover } from '../_lib/oidc.js';
import { getBusinessSession } from '../_lib/session.js';

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

export async function onRequestGet({ request, env }) {
  const config = getConfig(env);
  const { session } = await getBusinessSession(request, env, config);

  if (!session?.user_id) {
    return redirect('/main.html',302);
  }

  const idpLogoutUrl = await providerLogoutUrl(env, session.id_token_raw);
  if(!idpLogoutUrl) {
    return redirect('/main.html',302);
  }
  return redirect(idpLogoutUrl, 302);
}

export function onRequestPost() {
  return methodNotAllowed();
}
export function onRequest() {
  return methodNotAllowed();
}