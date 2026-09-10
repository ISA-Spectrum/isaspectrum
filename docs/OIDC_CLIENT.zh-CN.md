# ISA Spectrum 业务端 OAuth 2.0 / OIDC Client

本实现只负责 ISA Spectrum 业务网站。`baoyuechi/2fa_safemodule_dev` 是独立 Authorization Server / Identity Provider；业务站不会修改它，也不会调用其 WebAuthn、Recovery Code、OTP 或 Supabase GoTrue 内部登录接口。

## 1. 登录时序

```text
浏览器 -> GET /auth/login
业务后端 -> 生成 state、nonce、PKCE verifier/challenge、浏览器绑定值
业务后端 -> 在 oauth_transactions 保存哈希 state、verifier、nonce、回跳路径和过期时间
业务后端 -> 302 到 IdP /oauth/authorize（只发送 challenge）
IdP -> 自行完成密码、2FA、Passkey 等认证
IdP -> GET /auth/callback?code=...&state=...
业务后端 -> 原子消费 transaction，校验 state、浏览器绑定和有效期
业务后端 -> POST IdP /oauth/token（code + verifier）
业务后端 -> discovery/JWKS 验证 ID Token 的签名、iss、aud/azp、nonce、exp、iat、sub
业务后端 -> 可选调用 /oauth/userinfo，并校验返回 sub 一致
业务后端 -> 以 issuer + sub 查找或创建业务用户
业务后端 -> 创建随机业务 Session，仅把 HttpOnly Cookie 发给浏览器
浏览器 -> 后续只携带 business_session Cookie
```

授权码、IdP access token、ID Token、client secret、PKCE verifier、state 和 nonce均不写入普通应用日志或浏览器存储。IdP access token仅在服务端短暂用于可选的 UserInfo 请求，不作为业务登录态。

## 2. 新增或修改的主要文件

- `functions/auth/login.js`：开始 Authorization Code + PKCE 登录。
- `functions/auth/callback.js`：一次性 callback、换码、OIDC 验证、身份映射及 Session 创建。
- `functions/auth/session.js`、`functions/auth/logout.js`：读取/轮换及销毁业务 Session。
- `functions/_lib/oidc.js`：discovery、token exchange 与 JWKS/JWT 验证。
- `functions/_lib/crypto.js`、`config.js`、`http.js`、`store.js`、`session.js`：密码学、配置、Cookie、存储和 Session 基础设施。
- `functions/api/*`：校墙、上传、头像、通知、餐食及审核业务 API；所有写操作校验同源 Origin。
- `auth-client.js`：前端只读取业务 Session 状态及发起登录/退出，不接触任何 token。
- `supabase/oidc_client.sql`：业务用户、外部身份、OAuth transaction、业务 Session、通知与审核日志。
- `.dev.vars.example`：本地配置模板。
- `test/auth.test.js`：PKCE、跳转、HTTPS、审核授权和 ID Token 验证测试。

旧的 `auth-mfa.js`、MFA 页面与 `supabase/mfa_security.sql` 已移除。MFA 完全归认证中心负责。

## 3. OAuth Client 配置

```dotenv
AUTH_ISSUER=https://auth.example.com
AUTH_CLIENT_ID=由认证中心分配
AUTH_CLIENT_SECRET=仅 confidential client 设置
AUTH_REDIRECT_URI=https://www.example.com/auth/callback
AUTH_SCOPES=openid profile email
OIDC_ALLOWED_ALGORITHMS=RS256
```

代码从 `${AUTH_ISSUER}/.well-known/openid-configuration` 获取 authorization、token、userinfo 和 JWKS endpoint，不在前端硬编码 endpoint。生产 issuer 和 redirect URI 必须为 HTTPS。

## 4. `/auth/login`

只允许 GET。使用 Web Crypto 生成高熵 `state`、`nonce`、64 字节 PKCE verifier 和独立浏览器绑定值。数据库只保存 state 与绑定值的 SHA-256；verifier 只保存在服务端 transaction。Authorization Request 固定使用 `response_type=code`、`code_challenge_method=S256`。`return_to` 只接受同站路径，并禁止回到 `/auth/*`，因此不存在用户可控的跨站跳转。

审核页面与普通页面使用完全相同的登录请求，不发送 `acr_values`、`max_age`，也不要求用户绑定身份验证器。`checker-pending` 登录后只校验业务账号的 `is_checker` 权限。

## 5. `/auth/callback`

只允许 GET。先以 state 哈希与 HttpOnly 绑定 Cookie 原子消费 transaction；过期、已使用、跨浏览器或重复 callback 都失败。随后由服务端使用 code + verifier 换 token，并完成完整 OIDC 验证。成功登录会先撤销浏览器已有业务 Session，再签发全新 Session，防止旧 Session 并存。

## 6. PKCE

仅支持 S256。verifier 长度符合 RFC 7636，challenge 为 `BASE64URL(SHA256(verifier))`。verifier 不发送到 authorization endpoint、不进入 URL、不进入浏览器存储，只在 token exchange 使用一次。

## 7. State transaction 存储

`oauth_transactions` 位于业务数据库，保存 `state_hash`、`browser_binding_hash`、`code_verifier`、`nonce`、安全回跳路径、创建与过期时间。`consume_oauth_transaction()` 在 PostgreSQL 单条原子删除中完成匹配、未过期和未消费检查，成功返回 transaction 的同时立即删除，因此 callback 不能重放。默认有效期 10 分钟；开始新登录时会顺带清理过期 transaction 与 Session。

## 8. ID Token 验证

后端依据 discovery 的 `jwks_uri` 获取公钥，按 allowlist 接受 `RS256`（可显式配置 PS256/ES256），并验证 JWT signature、`iss`、`aud`、多 audience 时的 `azp`、`nonce`、`exp`、`iat` 和稳定 `sub`。JWKS 短缓存并在找不到 `kid` 时强制刷新一次。UserInfo 若可用，必须返回与 ID Token 相同的 `sub`。

## 9. Identity mapping

`external_identities` 对 `(issuer, subject)` 建唯一约束，并映射到 `business_users.user_id`。首次登录创建业务用户，后续仅更新 email/name 快照。绝不按 email 自动合并账户，也不接受 query/body 中的 email 决定业务用户。

审核员授权也必须按已验证的 issuer + sub 设置，而不是按邮箱：

```sql
update public.business_users u
set is_checker = true
from public.external_identities i
where i.user_id = u.user_id
  and i.issuer = 'https://auth.example.com'
  and i.subject = '认证中心提供的稳定 sub';
```

## 10. 业务 Session

Session token 由 32 字节安全随机数生成，数据库只保存 SHA-256 哈希。Cookie 为 `HttpOnly; Secure; SameSite=Lax; Path=/`，HTTPS 下使用 `__Host-business_session`，默认空闲有效期 8 小时、每 30 分钟轮换、绝对有效期 7 天。轮换为旧哈希保留 60 秒并发宽限，避免并行请求误清新 Cookie。前端 `/auth/session` 只能得到必要的业务用户信息及认证中心返回的可选认证元数据，不能读取 Session token。`amr`、`acr`、`auth_time` 当前仅作审计信息，不参与审核端权限判断。

## 11. Logout

`POST /auth/logout` 校验同源 `Origin`，在数据库撤销业务 Session 并清 Cookie。它不会假装同时退出认证中心。若未来需要全局登出，应按认证中心 discovery/协议另行接入 RP-Initiated Logout；不能共享父域 Cookie。

## 12. 错误处理

已处理取消和常见 OAuth/OIDC 失败：`access_denied`、`invalid_request`、`invalid_grant`、`login_required`、`interaction_required`、state/nonce/PKCE 问题、过期或复用 code、token endpoint/IdP 不可用及无效 ID Token。失败不会创建业务 Session，也不会根据 email 或 URL 参数自动登录。

## 13. 安全检查清单

- OAuth client 与 client secret只在服务端；浏览器无 token/localStorage/sessionStorage 登录态。
- Authorization Code + PKCE S256、state、nonce全部强制。
- transaction有有效期、浏览器绑定并原子单次消费。
- ID Token验签且校验 iss/aud/azp/nonce/exp/iat/sub。
- 身份唯一键为 issuer + sub，不是 email。
- access token不作为业务 Session；业务 Cookie不与认证中心共享。
- 无 iframe、无直接 MFA endpoint调用、无通配 redirect URI。
- 写 API校验 Origin；业务表撤销 anon/authenticated 直写，service role仅在 Functions 环境。
- 审核 API只要求有效的普通业务 Session 和数据库中的 `is_checker` 角色；不要求指定 acr、最近 auth_time、二次验证或身份验证器绑定。审核动作与日志原子写入。
- 首页与校墙统一读取安全业务 API；匿名数据库角色不能读取留言基础表或公开视图。API 响应不包含联系邮箱、legacy user_id、business_user_id 或审核字段。
- 应在 Cloudflare 日志/分析设置中禁用 callback query string 采集，并确认反向代理不会记录授权码。

## 14. 本地开发

1. 复制 `.dev.vars.example` 为未纳入 Git 的 `.dev.vars`。
2. 在**业务 Supabase**执行 `supabase/oidc_client.sql`；全新旧版库需先完成 `supabase/community_features.sql` 的表/分区前置迁移。不要在认证中心数据库执行。
3. 在认证中心登记精确回调 `http://127.0.0.1:8788/auth/callback`，仅本地允许 HTTP。
4. 使用 Cloudflare Pages Functions 本地运行器在 `127.0.0.1:8788` 启动仓库。
5. 执行 `npm test` 与 `npm run check`。

本地配置需设置 `AUTH_ALLOW_INSECURE_LOCALHOST=1`。不要把 `.dev.vars`、service role key 或 client secret提交到 Git。

## 15. 生产配置与发布顺序

1. 认证中心先完成 discovery/JWKS/authorize/token 实现并登记生产 Client。
2. 在 Cloudflare Pages Secrets 配置所有敏感值；非敏感配置也应使用环境变量。
3. 备份业务数据库，在维护窗口执行 `supabase/oidc_client.sql`。该迁移会撤销旧浏览器 Supabase 用户对业务表的直接权限，因此必须与新 Functions 同批切换。
4. 部署业务 Functions 和页面，验证正常登录、取消、重复 callback、过期 transaction、退出，以及审核员可访问、普通用户被拒绝。
5. 用真实 issuer + sub授予审核员角色；不要用 email匹配。
6. 检查 Cookie Secure、TLS、缓存、日志脱敏、密钥轮换与告警。

生产不得设置 `AUTH_ALLOW_INSECURE_LOCALHOST=1`。`AUTH_CLIENT_SECRET` 和 `BUSINESS_SUPABASE_SERVICE_ROLE_KEY` 必须是服务端 secret。

## 16. 与认证中心联调清单

认证中心需提供并确认：

- issuer 精确值及可访问的 OIDC discovery；
- client_id，及 Client 是 public 还是 confidential；
- confidential client 的 secret 与支持的 token endpoint auth method；
- 精确 redirect URI：生产、测试、本地分别显式登记，不使用通配符；
- grant type `authorization_code`、response type `code`、PKCE `S256`；
- scope `openid profile email`；
- ID Token签名算法、JWKS 轮换行为与 `kid`；
- `sub` 稳定性及 `iss`、`aud`、`exp`、`iat`、`nonce`；
- 可选 `auth_time`、`amr`、`acr` 的具体语义；当前业务站仅记录这些信息，不以其限制审核端访问；
- authorization code有效期、单次消费和错误码；
- UserInfo 是否启用及其 sub 一致性；
- revoke、RP-Initiated Logout 是否提供（当前不是业务登录必需项）。

Token endpoint 是服务端调用，不需要为浏览器开放 CORS。业务站不会要求认证中心共享 Cookie，也不会读取认证中心 Supabase Session。认证中心仍可按自己的全局安全策略选择认证方式，但业务站的审核入口不会主动请求 MFA、强制认证器绑定或调用任何 MFA 内部接口。
