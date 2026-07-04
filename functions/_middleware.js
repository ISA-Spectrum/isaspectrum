export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 静态资源直接放行（含 favicon.ico），使用 ASSETS 获取静态文件
  const staticSuffix = [
    ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif",
    ".css", ".js", ".mjs", ".ts",
    ".woff", ".woff2", ".ttf", ".otf",
    ".ico", ".map"
  ];
  const isStatic = staticSuffix.some(suffix => path.endsWith(suffix));
  if (isStatic || path === "/favicon.ico") {
    return env.ASSETS.fetch(request);
  }

  // 非 test 域名直接放行（也通过 ASSETS 返回 Pages 内容）
  if (!url.hostname.includes("test")) {
    return env.ASSETS.fetch(request);
  }

  // 以下为 test 域名的密码保护逻辑
  const realPassword = env.INNER_TEST_PASSWORD;
  if (!realPassword) {
    return new Response("Missing INNER_TEST_PASSWORD environment variable", { status: 500 });
  }

  const cookie = request.headers.get("cookie") || "";
  if (cookie.includes("inner_verify=ok")) {
    // 验证通过，返回真实的页面内容
    return env.ASSETS.fetch(request);
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

      // 密码错误页面（全局样式统一版）
      return new Response(
        `<!--
Copyright (c) 2026 ISA Spectrum
Copyright (c) 2026 沧海四象
Licensed under the MIT License.
-->
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta charset="UTF-8">
    <title>验证失败 | ISA Spectrum</title>
    <style>
        /* 全局初始化，与common.css完全对齐 */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        :root {
            --theme-color: #1e50ae;
            --secondary-color: #3F23B4;
            --text-gray: #999;
            --text-light-gray: #ccc;
        }
        body {
            font-family: "微软雅黑", sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #fff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .error-title {
            font-size: 26px;
            margin-bottom: 24px;
            color: #333;
        }
        .back-btn {
            padding: 10px 28px;
            border: 1px solid var(--theme-color);
            background: transparent;
            border-radius: 6px;
            font-size: 15px;
            cursor: pointer;
            transition: 0.2s all;
            text-decoration: none;
            color: var(--theme-color);
        }
        .back-btn:hover {
            background: var(--theme-color);
            color: #fff;
        }
    </style>
</head>
<body>
    <h2 class="error-title">密码验证失败</h2>
    <a class="back-btn" href="/">返回验证页面</a>
</body>
</html>`,
        { status: 403, headers: { "Content-Type": "text/html;charset=utf-8" } }
      );
    } catch (err) {
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // 登录页面（完整匹配项目全局设计规范）
  return new Response(
    `<!--
Copyright (c) 2026 ISA Spectrum
Copyright (c) 2026 沧海四象
Licensed under the MIT License.
-->
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta charset="UTF-8">
    <title>内测访问验证 | ISA Spectrum</title>
    <style>
        /* 全局初始化，同步 common.css */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        :root {
            --theme-color: #1e50ae;
            --secondary-color: #3F23B4;
            --text-gray: #999;
            --text-light-gray: #ccc;
        }
        body {
            font-family: "微软雅黑", sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #fff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            width: 100%;
            max-width: 420px;
            text-align: center;
        }
        .logo-text {
            font-size: 34px;
            font-weight: bold;
            color: var(--theme-color);
            margin-bottom: 12px;
        }
        .desc {
            font-size: 14px;
            color: var(--text-gray);
            margin-bottom: 36px;
        }
        .input-box {
            width: 100%;
            padding: 13px 16px;
            font-size: 16px;
            border: 1px solid var(--text-light-gray);
            border-radius: 8px;
            margin-bottom: 22px;
            outline: none;
            transition: border 0.2s ease;
        }
        .input-box:focus {
            border-color: var(--theme-color);
        }
        .submit-btn {
            width: 100%;
            padding: 13px;
            background: var(--theme-color);
            color: #ffffff;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        .submit-btn:hover {
            background: var(--secondary-color);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="logo-text">ISA Spectrum</h1>
        <p class="desc">内测站点访问验证，请输入访问密码继续浏览</p>
        <form method="POST" action="/_check_pass">
            <input class="input-box" name="pwd" placeholder="请输入内测访问密码" required autocomplete="off">
            <br>
            <button class="submit-btn" type="submit">进入内测站点</button>
        </form>
    </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html;charset=utf-8" } }
  );
}