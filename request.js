const PRIMARY_API = "https://isaspectrum.celestivast.com"; // 主站
const BACKUP_API = "https://api.celestivast.com";          // 备用站

let isFallback = false;

async function request(path, options = {}) {
  if (isFallback) return fetch(BACKUP_API + path, options);

  try {
    const controller = new AbortController();
    
    // 🎯 核心改动：如果是 POST/PUT/DELETE 等写操作，给 15 秒；读取（GET）依然 3 秒
    const isWrite = options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE';
    const timeoutDuration = isWrite ? 15000 : 3000;
    
    const timeout = setTimeout(() => controller.abort(), timeoutDuration); 

    const res = await fetch(PRIMARY_API + path, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    
    // 如果 CF 额度耗尽 (429) 或者服务器报错 (5xx)
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`主 API 异常，状态码: ${res.status}`);
    }
    
    return res;
  } catch (err) {
    // 动态显示是超时还是其他错误
    console.warn("🚨 主 API 不可用，自动切换备用！原因:", err.message);
    isFallback = true;
    
    // 5分钟后尝试重新探测主站
    setTimeout(() => { isFallback = false; }, 5 * 60 * 1000);
    
    return fetch(BACKUP_API + path, options);
  }
}

window.request = request;