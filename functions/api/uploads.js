import { authenticateApi } from '../_lib/api.js';
import { randomBase64Url } from '../_lib/crypto.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { uploadBusinessObject } from '../_lib/supabase.js';

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
  const bucket = kind === 'avatar' ? 'avatars' : 'message-pics';
  const urls = [];
  try {
    for (const file of files) {
      const path = kind === 'avatar'
        ? `business/${auth.session.user_id}.${extensionFor(file.type)}`
        : `business/${auth.session.user_id}/${randomBase64Url(24)}.${extensionFor(file.type)}`;
      urls.push(await uploadBusinessObject(env, auth.session, bucket, path, file, kind === 'avatar'));
    }
    return json({ urls }, 201, auth.headers);
  } catch {
    return json({ error: 'upload_failed' }, 503, auth.headers);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
