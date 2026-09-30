# 更新日志 / Changelog

## v4.0.0 Beta
- 全新统一认证：密码、Passkey、验证码、找回密码与二次验证全部交由独立认证中心处理（OAuth 2.0 / OIDC 授权码 + PKCE），本站只保存自己的业务会话，浏览器不接触任何认证令牌
- 校墙留言、餐食评分、通知、头像上传等业务数据改为经服务端按行级安全策略（RLS）访问，源码中不再使用 service_role
- 审核员权限改为按认证中心的 issuer + sub 判定，不再依赖邮箱匹配
- 修复登录失败时提示笼统、无法定位的问题：现在会分别提示签名算法、公钥、受众、时钟、客户端身份、业务库等具体原因
- 修复缓存响应头规则失效与同名头冲突的问题，并阻止仓库源码（测试脚本、SQL、文档）被公开下载

## v3.4.2
- 增加缓存规则，减少回源请求

## v3.4.1
- 进一步压缩大小优化算法保障网站首页加载速度

## v3.4.0
- 减小所有图片占用

## v3.3.2
- 通知页懒加载

## v3.3.1
- 专属报错页面

## v3.3.0
- 增加人机验证

## v3.2.2
- 修复找回密码系统 / Fix forgot-password.html & Create reset-password.html

## v3.2.1
- 修复Mac端无法下载问题 / Fix download issue on Mac

## v3.2.0
- 通过MIT许可证正式开源运行 / Officially open-sourced under MIT License

## v3.1.0
- 提供客户端下载 / Client download available

## v3.0.0
- 改为建楼形式 / Changed to thread-based format

## v2.0.0
- 全站内化 / Full site internalization

## v1.2.0
- 登录、注册与找回密码 / Login, registration & password recovery

## v1.1.0
- 新增回复功能 / Added reply feature

## v1.0.0（2026年5月23日）
- 第一个版本 / First version
- 网站部署 / Site deployment
- 正式开启公测 / Public beta launch
- 基础的校墙留言板功能和各个页面 / Basic school wall message board and various pages