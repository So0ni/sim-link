# Web/PWA 工作约定

- 本模块目前为 React + TypeScript 交互原型，数据全部虚构；不把演示会话、发送状态或设备状态描述为真实后端能力。
- 视觉沿用白底蓝色、SIM 下划线标签栏；手机独立详情，桌面列表与详情并排。行为以根目录 docs/UX.md 为准，设计值来自 design/tokens/tokens.json。
- 保持草稿按会话/SIM 隔离；未知发送结果不自动重发，网络失败不退出登录。
- 在本目录运行：`npm run dev -- --host 127.0.0.1`、`npm run build`、`npm run typecheck`、`npm test`。实际浏览器验证手机和桌面核心路径；原型交付前更新 design-qa.md。
- 持久化仅用于无敏感信息的演示登录标记。生产认证必须使用服务端会话，不复用该演示机制。
- 保留 .openai/hosting.json、worker/index.js、scripts/prepare-sites-build.mjs、tests/sites-worker.test.mjs 的模板部署兼容能力；未经用户要求不发布。
