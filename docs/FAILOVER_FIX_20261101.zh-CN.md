# 2026-11-01 主备后端修复及上线步骤

本地修复已完成；2026-11-01 已执行 Supabase 迁移并保存两边生产环境变量。代码部署状态见下方上线验证记录。

## 已确认的故障

- 线上 Cloudflare `/auth/session` 返回 401（正常未登录），`/auth/login` 返回 302。
- 线上 Vercel `/auth/login` 返回 503 configuration_error。
- request.js 的 3 秒读取超时/任意 5xx 会触发全局切换五分钟。登录 GET 探测也只有三秒，并会创建两次 OAuth transaction；手动重定向响应在浏览器中不可读取 Location。
- Vercel store.js 仍依赖 Cloudflare D1 的 env.AUTH_DB.prepare；Vercel 的 process.env 无法提供 D1 绑定。
- Vercel 分发器漏掉 POST/PATCH，部分 PUT 调用了不存在的方法。跨域写入被 sameOriginRequest 拒绝，auth 无 CORS，预检不完整。
- main、meal-rating、审核页面缺少 request.js；public-data 的备用读取引用了未定义的 request。

## 修复行为

读取超时延长到 20 秒，写入到 60 秒。单接口 5xx/网络错误只为当前读取回退；只有显式 429 才将后续请求转到备用站 60 秒，到期重试 Cloudflare。取消请求不回退。写入遇到超时/网络错误或 5xx 不自动重放，避免重复发布；明确 429 可以回退。所有备用请求携带 Cookie。

登录/退出先探测无副作用的 session，再整页导航；真实登录不受三秒超时打断。退出会撤销业务会话。Vercel callback 返回 Cloudflare 前端，OAuth transaction cookie 保持绑定当前认证主机。

## 上线顺序（必须完成共享存储才能正常接力）

1. 在 Supabase 项目 bbcnrsktqarvceekrswb 的 SQL Editor 执行 `supabase/20261101_shared_auth_store.sql`（两仓库内容相同，只执行一次）。它创建独立私有 schema 和仅 service_role 可调用的 RPC，不改动现有业务表。OAuth 原子消费和 Session 轮换均在数据库单条语句内执行。SQL 已在真实 Supabase PostgreSQL 执行成功，并通过 API 验证。
2. 两边后端设置 AUTH_STORE=supabase，以及同一个 AUTH_STORE_SUPABASE_SECRET_KEY（该 Supabase 项目的后端 secret key 或旧版 service_role key）。仅作为 Cloudflare/Vercel 的后端加密变量，不能写入前端文件或 Git。现有 publishable key 无权访问此 RPC。
3. BUSINESS_SUPABASE_URL / BUSINESS_SUPABASE_PUBLISHABLE_KEY / BUSINESS_SUPABASE_SIGNING_JWK 保持指向同一项目。后者仍用于原有业务 RLS；新增后端 key 只用于共享会话 RPC。
4. Cloudflare AUTH_REDIRECT_URI=https://isaspectrum.celestivast.com/auth/callback；Vercel AUTH_REDIRECT_URI=https://api.celestivast.com/auth/callback。Keycloak 的同一个 isa-spectrum client 必须允许这两个精确回调地址。AUTH_POST_LOGOUT_REDIRECT 可均指向 https://isaspectrum.celestivast.com/auth/post-logout，并在 Keycloak 注册。
5. 推送两个仓库并等待部署完成；先发布已配置好的 Vercel，再发布 Cloudflare。两边必须使用共享 Supabase 存储，不能一边 D1 一边 Supabase。迁移后原 D1 登录状态不自动导入，现有用户需重新登录一次。Cloudflare 默认仍使用 D1，方便在尚未迁移时单独上线误切换修复；Vercel 默认 Supabase。
6. 验证：未登录 session=401；两边 login=302 且各自 redirect_uri 正确；主站登录后经两边 session 都为 authenticated=true；备站 POST/PATCH 预检=204 且有正确 CORS；通过备用后端发布/审核各一次；模拟 429 切换并等待恢复；退出后两边 session 均为401。不要为了测试耗尽真实额度。

## 回滚

AUTH_STORE 切回 d1 仅能恢复 Cloudflare 旧会话，Vercel 无法使用 D1。无需删除新建私有表；保留原 D1 绑定。若只发布前端修复，备用认证仍不可用，不能将其视为完整修复。

## 线上配置及数据库验证记录

- Supabase SQL Editor 执行成功；两边生产环境已保存 AUTH_STORE=supabase、加密 AUTH_STORE_SUPABASE_SECRET_KEY。未将密钥值写入仓库。
- Vercel AUTH_REDIRECT_URI 已保存为 https://api.celestivast.com/auth/callback（Production and Preview）。新增会话存储密钥仅配置 Production；若启用 Preview，需要单独配置对应环境。
- 实际 API 验证通过：并发 OAuth 状态仅一次消费成功；会话创建、读取、轮换、旧令牌宽限、注销通过；publishable key 请求会话 RPC 返回401。测试会话已撤销并在两分钟内过期。
- 本地 Cloudflare 27 项、Vercel 30 项测试通过；两边语法检查及 git diff --check 通过。
