async function signJWT(payload, secret) {
  const enc = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  
  const b64url = (obj) => btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const headerB64 = b64url(header);
  const payloadB64 = b64url({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
  
  const data = `${headerB64}.${payloadB64}`;
  
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  return `${data}.${sigB64}`;
}

export async function onRequest({ request, env }) {
  const supabaseUrl = 'https://bbcnrsqtgarvceekrswb.supabase.co';
  const anonKey = 'sb_publishable_f3Kav8ipJco_f9tw5zO50A_w7KigE5D';
  const jwtSecret = env.SUPABASE_JWT_SECRET;

  if (!jwtSecret) return new Response("Server config missing", {status:500});

  // 1. 校验会话，拿到当前用户身份（复用你已有/auth/session）
  const sessionUrl = new URL("/auth/session", request.url);
  const sessionRes = await fetch(sessionUrl.toString(), { headers: request.headers });
  const sessionData = await sessionRes.json();

  if (!sessionRes.ok || !sessionData?.sub) {
    return new Response(JSON.stringify({error:"Unauthorized"}), {
      status:401, headers:{"Content-Type":"application/json"}
    });
  }

  // 2. 伪造Supabase标准JWT，sub=当前登录用户UUID
  const fakeJwt = await signJWT({
    role: "authenticated",
    sub: sessionData.sub,
    email: sessionData.email || ""
  }, jwtSecret);

  // 3. 转发请求到Supabase，替换Authorization头
  const targetUrl = new URL(request.url);
  targetUrl.host = new URL(supabaseUrl).host;
  targetUrl.pathname = targetUrl.pathname.replace(/^\/api\/db-proxy/, "");

  const supHeaders = new Headers(request.headers);
  supHeaders.set("apikey", anonKey);
  supHeaders.set("Authorization", `Bearer ${fakeJwt}`);

  const resp = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: supHeaders,
    body: request.method !== 'GET' ? await request.text() : undefined,
  });

  return new Response(resp.body, { status: resp.status, headers: resp.headers });
}
