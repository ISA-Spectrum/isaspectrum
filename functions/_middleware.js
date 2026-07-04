export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 主站直接放行（不是测试域名就正常回源）
  if (!url.hostname.includes("test")) {
    return fetch(request);
  }

  // 静态资源直接放行（含 favicon.ico）
  const staticSuffix = [
    ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif",
    ".css", ".js", ".mjs", ".ts",
    ".woff", ".woff2", ".ttf", ".otf",
    ".ico", ".map"
  ];
  const isStatic = staticSuffix.some(suffix => path.endsWith(suffix));
  if (isStatic || path === "/favicon.ico") {
    return fetch(request);
  }

  // 无密码变量时返回明确错误，避免 Worker 无响应
  const realPassword = env.INNER_TEST_PASSWORD;
  if (!realPassword) {
    return new Response("Missing INNER_TEST_PASSWORD environment variable", { status: 500 });
  }

  // 已通过验证则放行
  const cookie = request.headers.get("cookie") || "";
  if (cookie.includes("inner_verify=ok")) {
    return fetch(request);
  }

  // 密码提交接口
  if (request.method === "POST" && path === "/_check_pass") {
    try {
      const form = await request.formData();
      const inputPwd = form.get("pwd");

      if (inputPwd === realPassword) {
        return new Response("", {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": "inner_verify=ok; Path=/; Max-Age=86400; SameSite=Lax"
          }
        });
      }

      // 密码错误
      return new Response(
        `<h2 style="text-align:center;margin-top:80px;">密码错误</h2>
         <p style="text-align:center;"><a href="/">返回</a></p>`,
        { status: 403, headers: { "Content-Type": "text/html;charset=utf-8" } }
      );
    } catch (err) {
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // 密码登录页
  return new Response(
    `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>ISA Spectrum 内测验证</title>
      <style>
        body { text-align:center; margin-top:120px; font-family:system-ui; }
        input { padding:10px; width:320px; font-size:16px; margin:24px 0; }
        button { padding:10px 30px; font-size:16px; cursor:pointer; }
      </style>
    </head>
    <body>
      <h1>ISA Spectrum 内测站点访问验证</h1>
      <form method="POST" action="/_check_pass">
        <input name="pwd" placeholder="请输入内测访问密码" required>
        <br>
        <button type="submit">进入内测站</button>
      </form>
    </body>
    </html>`,
    { headers: { "Content-Type": "text/html;charset=utf-8" } }
  );
}