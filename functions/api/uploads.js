import { authenticateApi } from '../_lib/api.js';
import { randomBase64Url } from '../_lib/crypto.js';
import { json, methodNotAllowed } from '../_lib/http.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extensionFor(type) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[type];
}

export async function onRequestPost({ request, env }) {
  const auth = await authenticateApi(request, env);
  if (auth.response) return auth.response;
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'invalid_request' }, 400, auth.headers); }
  const kind = form.get('kind') === 'avatar' ? 'avatar' : 'message';
  const files = form.getAll('files').filter(value => value instanceof File);
  const maxFiles = kind === 'avatar' ? 1 : 5;
  if (!files.length || files.length > maxFiles || files.some(file => !ALLOWED_TYPES.has(file.type) || file.size > 5 * 1024 * 1024)) {
    return json({ error: 'invalid_upload' }, 400, auth.headers);
  }
  const base = String(env.BUSINESS_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.BUSINESS_SUPABASE_SERVICE_ROLE_KEY || '');
  if (!base || !key) return json({ error: 'configuration_error' }, 503, auth.headers);
  const bucket = kind === 'avatar' ? 'avatars' : 'message-pics';
  const urls = [];
  try {
    for (const file of files) {
      const path = kind === 'avatar'
        ? `business/${auth.session.user_id}.${extensionFor(file.type)}`
        : `business/${auth.session.user_id}/${randomBase64Url(24)}.${extensionFor(file.type)}`;
      const response = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': file.type,
          'x-upsert': kind === 'avatar' ? 'true' : 'false'
        },
        body: file
      });
      if (!response.ok) throw new Error('upload_failed');
      urls.push(`${base}/storage/v1/object/public/${bucket}/${path}`);
    }
    return json({ urls }, 201, auth.headers);
  } catch {
    return json({ error: 'upload_failed' }, 503, auth.headers);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
