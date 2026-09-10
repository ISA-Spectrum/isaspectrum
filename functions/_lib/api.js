import { getConfig } from './config.js';
import { json, sameOriginRequest } from './http.js';
import { getBusinessSession } from './session.js';

export async function authenticateApi(request, env, options = {}) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOriginRequest(request)) {
    return { response: json({ error: 'invalid_origin' }, 403) };
  }
  let config;
  try { config = getConfig(env); } catch { return { response: json({ error: 'configuration_error' }, 503) }; }
  let result;
  try { result = await getBusinessSession(request, env, config, true); } catch {
    return { response: json({ error: 'session_unavailable' }, 503) };
  }
  const headers = result.setCookie ? { 'Set-Cookie': result.setCookie } : {};
  if (!result.session) return { response: json({ error: 'authentication_required' }, 401, headers) };
  if (options.checker && result.session.is_checker !== true) {
    return { response: json({ error: 'forbidden' }, 403, headers) };
  }
  return { session: result.session, config, headers };
}

export function integerParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function cleanText(value, maxLength) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : '';
}

export function shanghaiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
