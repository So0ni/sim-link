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
- 收件增量拉取、按设备/订阅/发件人分组、SIM 筛选、完整正文和复制；可见页面约每 5 秒刷新。
- 已配对设备列表、一次性配对凭证、撤销设备；展示最近联系与推断在线，分别表达 SIM 状态。
- 短信只存在页面内存，无 localStorage 短信缓存；私密 API 始终鉴权。

Android 上传已接通；本轮阅读状态 QA 使用独立库和虚构消息。已实现服务端已读/未读、可见消息自动标读、手动标记、未读与 SIM 交集筛选，以及独立状态游标跨浏览器同步。验证码提取及专用复制功能已取消。远程发件和通知未实现。生产构建已包含manifest、安装图标、静态外壳Service Worker和用户确认更新；iOS 主屏幕持久登录仍待真机验证。阅读行为与限制见 [UX](../../docs/UX.md)，验收见 [阅读状态验收](../../docs/READING-ACCEPTANCE.md)。

## 隔离的设计原型

`npm run dev:demo` 或 `npm run build:demo` 显式构建演示版；src/demo 内有原有虚构短信、模拟发送、离线开关和 localStorage 演示会话。默认生产构建不包含这些模块，不能将演示产物部署成真实服务入口。

`build:client` 仅生成 dist/client，供 Docker 同源托管；`build` 保留模板 Sites 打包兼容产物。没有执行发布。视觉 tokens 来自 design/tokens/tokens.json；本轮 QA 见 design-qa.md。

## PWA

`build` / `build:client` 自动生成安装清单、图标链接与版本化 `sw.js`，无需新增依赖。开发服务器和demo不注册Worker。安装/更新入口位于设置页；iPhone通过Safari分享菜单添加到主屏幕。详细缓存边界、升级和真机验收见 [PWA说明](../../docs/PWA.md)。

离线只保证已成功预缓存的应用外壳，不提供离线短信或离线登录。Worker只预缓存构建白名单，API保持网络访问；不缓存认证响应。新版本等待用户确认或旧页面全部关闭后激活，确认更新会刷新所有已受控页面。图标使用现有蓝色与SIM矢量图形，PNG可运行 `python3 scripts/generate-icons.py` 再生成。

## P2 发送

收件箱“新建 / 发件”打开编辑与最近200条状态；国际号码会话可带原SIM回复。手机需升级并在权限页主动启用。明确选卡，5分钟有效期，离线默认保留草稿；显式等待上线才排队。网络提交不确定时核对原请求键，不生成新键。草稿只存当前页面进程，刷新/退出/升级会丢失。分段成功只代表系统已发送，无送达报告；未知或部分发送不自动重发。
