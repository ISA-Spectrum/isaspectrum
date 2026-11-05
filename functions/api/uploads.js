import { authenticateApi } from '../_lib/api.js';
import { randomBase64Url } from '../_lib/crypto.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { uploadBusinessObject, requestBusinessData, listAvatarObjects, deleteAvatarObjects } from '../_lib/supabase.js';

import { validateAvatar, AVATAR_LIMIT, AVATAR_RETENTION_MS } from '../_lib/avatar.js';

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
  if (!files.length || files.length > maxFiles || files.some(file => !file.size || !ALLOWED_TYPES.has(file.type) || file.size > 5 * 1024 * 1024)) {
    return json({ error: 'invalid_upload' }, 400, auth.headers);
  }
  const bucket = kind === 'avatar' ? 'avatars' : 'message-pics';
  let avatarPath;
  if (kind === 'avatar') {
    let hash;
    try { hash = await validateAvatar(files[0]); }
    catch { return json({ error: 'invalid_avatar_image' }, 400, auth.headers); }
    avatarPath = `business/${auth.session.user_id}.${hash}.png`;
    try {
      const all = [];
      for (let offset = 0; ; offset += 100) {
        const page = await listAvatarObjects(env, auth.session, offset);
        if (!Array.isArray(page)) throw new Error('invalid_storage_response');
        all.push(...page);
        if (page.length < 100) break;
        if (all.length >= 1000) return json({ error: 'avatar_storage_limit' }, 429, auth.headers);
      }
      const own = all.filter(item => item.name?.startsWith(auth.session.user_id + '.'));
      const rows = await requestBusinessData(env, auth.session, `business_users?user_id=eq.${encodeURIComponent(auth.session.user_id)}&select=avatar_url&limit=1`);
      let currentPath = null;
      try { currentPath = new URL(rows?.[0]?.avatar_url).pathname; } catch {}
      const prefix = '/storage/v1/object/public/avatars/business/';
      const obsolete = own.filter(item => {
        const created = Date.parse(item.created_at);
        return Number.isFinite(created) && Date.now() - created > AVATAR_RETENTION_MS && prefix + item.name !== currentPath && 'business/' + item.name !== avatarPath;
      });
      // The accompanying database policies serialize deletion with profile saves
      // and refuse removal of any object currently referenced by a profile.
      for (const item of obsolete) await deleteAvatarObjects(env, auth.session, ['business/' + item.name]);
      if (own.some(item => 'business/' + item.name === avatarPath)) return json({ urls: [String(env.BUSINESS_SUPABASE_URL).replace(/\/$/, '') + '/storage/v1/object/public/avatars/' + avatarPath] }, 201, auth.headers);
      if (own.length - obsolete.length >= AVATAR_LIMIT && !own.some(item => 'business/' + item.name === avatarPath)) return json({ error: 'avatar_storage_limit' }, 429, auth.headers);
    } catch { return json({ error: 'avatar_storage_unavailable' }, 503, auth.headers); }
  }
  const urls = [];
  try {
    for (const file of files) {
      const path = kind === 'avatar'
        ? avatarPath
        : `business/${auth.session.user_id}/${randomBase64Url(24)}.${extensionFor(file.type)}`;
      urls.push(await uploadBusinessObject(env, auth.session, bucket, path, file, false, kind === 'avatar'));
    }
    return json({ urls }, 201, auth.headers);
  } catch {
    return json({ error: 'upload_failed' }, 503, auth.headers);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
