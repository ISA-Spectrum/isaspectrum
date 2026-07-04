export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // 只拦截test域名，主站直接放行
  if (!url.hostname.includes("test")) {
    return;
  }

  // 环境变量兜底判断，不存在就直接放行，不崩溃
  const realPassword = env.INNER_TEST_PASSWORD;
  if (!realPassword) return;

  const cookie = request.headers.get("cookie") || "";
  if (cookie.includes("inner_verify=ok")) return;

  if (request.method === "POST" && url.pathname === "/_check_pass") {
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
    return new Response(`
      <h2 style="text-align:center;margin-top:80px;">密码错误</h2>
      <p style="text-align:center;"><a href="/">返回</a></p>
    `, { status: 403, headers: { "Content-Type": "text/html;charset=utf-8" } });
  }

  return new Response(`
    <!DOCTYPE html>
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
    </html>
  `, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}