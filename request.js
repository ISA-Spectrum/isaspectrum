// Cloudflare first. Only an explicit quota response opens the short circuit.
const PRIMARY_API = location.origin === 'https://api.celestivast.com'
  ? 'https://isaspectrum.celestivast.com' : location.origin;
const BACKUP_API = 'https://api.celestivast.com';
let fallbackUntil = 0;
async function request(path, options = {}) {
  if (!/^\/(api|auth)\//.test(path)) throw new Error('invalid_api_path');
  const method = (options.method || 'GET').toUpperCase();
  const read = method === 'GET' || method === 'HEAD';
  const init = { credentials: 'include', ...options, method };
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError');
  if (Date.now() < fallbackUntil) return fetch(BACKUP_API + path, init);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), read ? 20000 : 60000);
  let response;
  try {
    response = await fetch(PRIMARY_API + path, { ...init, signal: controller.signal });
  } catch (error) {
    if (options.signal?.aborted || !read) throw error;
    return fetch(BACKUP_API + path, init);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  if (response.status === 429) fallbackUntil = Date.now() + 60000;
  // Never replay an ambiguous write: the first server may already have committed it.
  if (response.status === 429 || (read && response.status >= 500)) {
    return fetch(BACKUP_API + path, init);
  }
  return response;
}
window.request = request;
