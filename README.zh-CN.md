![LOGO](./images/web-app-manifest-512x512.png)

Language：简体中文｜[English](./README.md)



# ISA Spectrum
ISA Wuhan 校园社区平台

## 项目介绍
ISA Spectrum 是专为 **ISA Wuhan** 设计的校园社区网站，面向师生与社群成员提供信息交流、社区互动的线上平台。
项目采用静态前端、Cloudflare Pages Functions 与业务 Supabase 数据库。用户认证由独立 OIDC 认证中心负责，本站只维护业务身份与业务 Session。

## 核心功能
- 校园社区内容浏览与展示
- 校园墙供所有人交流讨论
- 用户数据与内容存储（基于 Supabase 数据库）
- 响应式布局，支持电脑、手机访问
- 社群公告与信息同步

## 技术栈
- 前端：HTML、CSS、JavaScript
- 后端：Cloudflare Pages Functions
- 数据库：Supabase（业务数据，不作为本站浏览器登录态）
- 登录：OAuth 2.0 Authorization Code + PKCE / OpenID Connect
- 部署方式：Cloudflare Pages

## 本地运行指南
1. 克隆本仓库到本地
2. 将 `.dev.vars.example` 复制为 `.dev.vars` 并填写本地 OIDC/业务数据库配置
3. 在业务 Supabase 执行 `supabase/oidc_client.sql`
4. 使用 Cloudflare Pages Functions 本地运行器启动；认证路由不能只靠静态文件服务器运行
5. 执行 `npm test` 和 `npm run check`

## 数据库功能初始化

在 Supabase SQL Editor 中执行 `supabase/community_features.sql`。该脚本会：

- 为校墙增加真实 `zone` 字段并迁移旧留言
- 创建不包含联系邮箱与业务身份字段的安全投影视图（OIDC 切换后浏览器无读取权限）
- 创建每日餐食评分表及仅限本人读写的 RLS 策略

## OAuth / OIDC 登录

业务站是 OAuth/OIDC Client，认证中心负责密码、Passkey、OTP、恢复码和 MFA。业务站不会复制 MFA，也不会把认证中心 access token 当作业务 Session。完整架构、配置、数据库迁移和联调清单见 [业务端 OIDC 文档](./docs/OIDC_CLIENT.zh-CN.md)。

## 项目结构
- index.html            项目屏闪页
- main.html             项目主页
- notice.html           站内公告页
- messages.html         校墙交流页
- details.html          动态详情页
- about.html            团队介绍页
- contact.html          联系方式
- download.html         客户端下载服务
- login.html            校墙登录页
- functions/auth/       OAuth/OIDC 与业务 Session 路由
- functions/api/        受业务 Session 保护的业务 API
- auth-client.js        无 token 的浏览器 Session 辅助代码
- register.html         校墙注册页
- forgot-password.html  找回密码页
- header.html           通用导航栏
- footer.html           通用页脚
- common.css            通用样式
- common.js             公共工具函数
- images/               图片资源文件夹
- supabase/             业务数据库迁移
（管理端部分省略，用户使用时不会用到）

## 贡献指南
欢迎 ISA 成员与开发者参与贡献！
1. Fork 本仓库
2. 创建你的分支
3. 完成修改并提交
4. 提交 Pull Request

## License
本项目采用 MIT 许可证 - 详见 [LICENSE](./LICENSE) 文件。
