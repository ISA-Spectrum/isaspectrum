![LOGO](./images/web-app-manifest-512x512.png)

Language：简体中文｜[English](./README.md)



# ISA Spectrum
ISA Wuhan 校园社区平台

## 项目介绍
ISA Spectrum 是专为 **ISA Wuhan** 设计的校园社区网站，面向师生与社群成员提供信息交流、社区互动的线上平台。
项目采用纯前端 + Supabase 后端架构，实现轻量化、云端化的校园社区服务。

## 核心功能
- 校园社区内容浏览与展示
- 校园墙供所有人交流讨论
- 用户数据与内容存储（基于 Supabase 数据库）
- 响应式布局，支持电脑、手机访问
- 社群公告与信息同步

## 技术栈
- 前端：HTML、CSS、JavaScript
- 后端 / 数据库：Supabase
- 部署方式：Cloudflare Pages

## 本地运行指南
1. 克隆本仓库到本地
2. 配置 Supabase 相关环境信息
3. 使用本地服务器打开项目（推荐）
4. 直接访问 index.html 即可启动

## 数据库功能初始化

在 Supabase SQL Editor 中执行 `supabase/community_features.sql`。该脚本会：

- 为校墙增加真实 `zone` 字段并迁移旧留言
- 创建不暴露联系邮箱的首页公开同步视图
- 创建每日餐食评分表及仅限本人读写的 RLS 策略

## MFA 配置
1. 在 Supabase 控制台的 Authentication → Multi-Factor Authentication 中启用 TOTP
2. 在 SQL Editor 中执行 `supabase/mfa_security.sql`
3. 将其中的 `has_aal2()` 与 `is_checker()` 同时加入审核数据、联系邮箱和管理操作的现有 RLS 策略

普通账号可以在 `security.html` 自助绑定验证器；审核员登录时必须完成绑定和动态验证码验证。`auth-mfa.js` 提供 `registerProvider()`，后续可用相同接口注册其他 MFA 验证方式。

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
- security.html         两步验证管理页
- mfa-setup.html        身份验证器绑定页
- mfa-challenge.html    动态验证码验证页
- register.html         校墙注册页
- forgot-password.html  找回密码页
- header.html           通用导航栏
- footer.html           通用页脚
- common.css            通用样式
- common.js             公共工具函数
- images/               图片资源文件夹
- Supabase              提供后端数据支持
（管理端部分省略，用户使用时不会用到）

## 贡献指南
欢迎 ISA 成员与开发者参与贡献！
1. Fork 本仓库
2. 创建你的分支
3. 完成修改并提交
4. 提交 Pull Request

## License
本项目采用 MIT 许可证 - 详见 [LICENSE](./LICENSE) 文件。
