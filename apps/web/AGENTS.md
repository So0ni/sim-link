# Web/PWA 工作约定

- 默认入口为真实 API 客户端，按 app / features / shared 划分，见 docs/ARCHITECTURE.md。src/demo 仅用于显式演示构建，生产模块不得导入其数据或状态，不得在网络失败时回退到演示。
- 视觉沿用白底蓝色、SIM 下划线标签栏；手机独立详情，桌面列表与详情并排。行为以根目录 docs/UX.md 为准，设计值来自 design/tokens/tokens.json。
- 保持草稿按会话/SIM 隔离；未知发送结果不自动重发，网络失败不退出登录。
- 在本目录运行：`npm run dev -- --host 127.0.0.1`、`npm run build`、`npm run typecheck`、`npm test`。实际浏览器验证手机和桌面核心路径；原型交付前更新 design-qa.md。
- 生产认证使用服务端 HttpOnly Cookie，CSRF、配对码和未提交草稿仅存内存。用户授权缓存近期短信、设备/SIM和发件视图；仅在服务端确认当前会话后恢复同会话的本地快照，退出或401清除。Service Worker仍不缓存API响应。
- 保留 .openai/hosting.json、worker/index.js、scripts/prepare-sites-build.mjs、tests/sites-worker.test.mjs 的模板部署兼容能力；未经用户要求不发布。

- 生产构建由 scripts/pwa-build.mjs 生成带内容版本的 Service Worker，仅预缓存静态白名单；API、带查询参数请求及写请求不进入 Cache Storage。开发和 demo 不注册 Worker；改缓存策略须运行 npm test 中的 PWA 隔离测试。
