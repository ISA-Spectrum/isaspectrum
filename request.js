const PRIMARY_API = "https://isaspectrum.celestivast.com"; //主站
const BACKUP_API = "https://api.celestivast.com";          //备用站

let isFallback = false;

export async function request(path, options = {}) {
  if (isFallback) return fetch(BACKUP_API + path, options);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); 

    const res = await fetch(PRIMARY_API + path, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`主 API 异常，状态码: ${res.status}`);
    }
    
    return res;
  } catch (err) {
    console.warn("🚨 主 API 不可用，3秒后自动切换备用！原因:", err.message);
    isFallback = true;
    setTimeout(() => { isFallback = false; }, 5 * 60 * 1000);
    return fetch(BACKUP_API + path, options);
  }
}