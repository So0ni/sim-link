# SIMLink Web

React + TypeScript。默认入口已接入服务端持久登录、收件列表/详情及设备配对管理，保留白蓝配色、SIM 筛选和响应式双栏。结构见 [工程架构](../../docs/ARCHITECTURE.md)。

## 运行

Node.js 22.16+。在本目录：

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:sites
```

推荐通过 [后端 Compose](../../services/api/README.md) 同源部署。开发热更新时，先在 services/api 按 README 初始化管理员，再用 `PUBLIC_ORIGIN=http://127.0.0.1:5173 ALLOW_INSECURE_LOCAL=1 npm start` 启动后端；前端 `npm run dev -- --host 127.0.0.1 --port 5173`。Vite 将 /api 和 /.well-known 转发至 127.0.0.1:8787，PUBLIC_ORIGIN 必须与浏览器访问地址一致。

## 当前真实能力

- 管理员密码登录，默认持久会话；启动/回前台恢复，断网不退出；退出撤销服务端会话。
- 收件增量拉取、按设备/订阅/发件人分组、SIM 筛选、完整正文和复制；可见页面每 15 秒刷新。
- 已配对设备列表、一次性配对凭证、撤销设备；尚不显示设备在线保证。
- 短信只存在页面内存，无 localStorage 短信缓存；私密 API 始终鉴权。

Android 上传尚未接通；本轮浏览器 QA 用虚构消息通过实际 API 入库。尚无跨端已读、远程发件、自动验证码提取、通知、Service Worker 或完整安装离线能力，iOS 主屏幕持久登录仍待真机验证。

## 隔离的设计原型

`npm run dev:demo` 或 `npm run build:demo` 显式构建演示版；src/demo 内有原有虚构短信、模拟发送、离线开关和 localStorage 演示会话。默认生产构建不包含这些模块，不能将演示产物部署成真实服务入口。

`build:client` 仅生成 dist/client，供 Docker 同源托管；`build` 保留模板 Sites 打包兼容产物。没有执行发布。视觉 tokens 来自 design/tokens/tokens.json；本轮 QA 见 design-qa.md。
