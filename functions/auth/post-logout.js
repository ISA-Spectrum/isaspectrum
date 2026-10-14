import { destroyBusinessSession } from '../_lib/session.js';

export async function onRequestGet({ request, env }) {
  // 获取清除session的Set‑Cookie字符串
  const setCookieStr = await destroyBusinessSession(request, env);

  const headers = new Headers();
  headers.set("Location", "/main.html");
  // Set‑Cookie允许多个，用append，不要set，防止覆盖
  headers.append("Set-Cookie", setCookieStr);

  return new Response(null, {
    status: 302,
    headers
  });
}

// 只允许GET
export function onRequest() {
  return new Response(null, { status: 405 });
}