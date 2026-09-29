# 工程架构 · 模块化单体

部署仍为一个 Node.js 进程、一个 SQLite 数据库、同源 Web 静态资源。HTTPS 由主机现有代理管理。按业务能力划分代码归属，不按端口或容器拆分业务。一个功能的接口、权限、状态和持久化应能在明确的模块范围内理解。

## 当前目录与依赖

```text
apps/web/src/
  main.tsx                 # 构建入口、tokens、生产/演示选择
  app/                     # 导航、会话门禁、页面装配
  features/
    auth/                  # 会话状态机、登录页面
    inbox/                 # 收件 API、分组模型、拉取 hook、列表详情
    devices/               # 设备 API、配对与撤销页面
  shared/api/              # HTTP、Cookie/CSRF、错误分类
  demo/                    # 原型状态、虚构数据、模拟发送；仅显式演示构建

services/api/src/
  server.mjs               # 环境、监听、退出
  app.mjs                  # 依赖装配、生命周期、模块注册
  platform/                # SQLite 迁移/连接、HTTP 策略、限流、密码学基础
  modules/
    auth/                  # credentials、service、HTTP policy、routes
    devices/               # service、routes
    inbox/                 # service、routes
  admin.mjs                # CLI 管理员初始化，调用 auth 能力
```

Web：`app → features → shared`。功能模型不访问 DOM/fetch/localStorage；请求集中在 feature API 或 auth controller，共享 HTTP 客户端只负责传输。业务页面不直接导入其他 feature 的内部状态；应用层负责组合。客户端不导入服务端源码，服务端不导入 Web 源码，Docker 只复制静态构建产物。

后端：`server → app → routes → service → platform`。route 负责 HTTP 参数、鉴权、响应；service 拥有业务规则、SQL 和事务。SQL 暂保留在对应功能 service 内，避免为每条查询创建无意义的通用 repository。一个功能的查询明显增长、需要替换存储或复用查询时，再在该功能内提取 repository；不建立所有模块都可任意操作的“大数据访问层”。所有表结构迁移由 platform/store 统一排序执行，功能模块仅修改自己拥有的状态。

模块依赖通过 app 显式注入（数据库、时钟、服务和会话策略），不使用全局服务定位器。inbox 通过设备服务验证凭证，不直接查询 devices 表；设备模块不读取 sessions 表。通用 token/hash/scrypt 工具属于 platform，不能为了复用随机数而依赖管理员初始化逻辑。平台层不得反向导入业务模块。

## 真实功能与原型隔离

默认 `npm run dev`、`build`、`build:client` 和 Docker 均使用真实 API。`dev:demo` / `build:demo` 显式启用 VITE_SIMLINK_DEMO=1。生产构建排除 demo 模块；网络失败不回退到虚构数据、不采用 localStorage 演示登录标记。原型保留用于设计回归，不代表已实现业务。

当前生产入口展示登录/会话、收件、设备列表、配对二维码、心跳推断在线和解绑清理。不显示虚构在线状态、模拟发送成功或本地已读冒充跨端同步。阅读状态独立版本同步已实现；通知和发件待迭代；SIM持久映射及安装身份已实现，详见 SIM-MAPPING.md 与 DEVICE-IDENTITY.md。

## 异步与权限边界

- 会话状态为 restoring / guest / ready / unavailable。初次启动先核实会话；已登录后回到前台在原界面重验证，短时网络失败保留已加载内容和 Cookie，明确 401 才清理私密页面并回到登录。
- CSRF 只在内存；Cookie 由浏览器管理。session GET 不续期，仅前台 resume 续期。退出失败需提示，不能只清 UI 而谎称服务端退出成功。
- HTTP 客户端及会话 controller 使用代次隔离，旧请求不能使新登录失效，晚到恢复不能复活已退出会话。私密页面卸载时取消收件请求并丢弃内存短信。
- 收件以服务端 sequence 增量拉取并去重；receivedAt 决定会话时间顺序，补传不会伪装成新接收。会话分组为 deviceId + (simKey，旧消息无此字段时回退 subscriptionId) + sender，未知订阅明确显示未知，不把订阅号当卡槽或长期身份。
- 页面在可见且联网时定期读取，每次请求完成约 5 秒后继续，失败退避最长 60 秒，恢复前台/联网立即检查；每轮最多 20 页，下一轮继续。数据当前仅存内存，切页/重新登录重新加载；短信仍无持久客户端缓存；Service Worker仅缓存构建时静态外壳白名单，见PWA.md。
- 配对令牌只在当前页面内存展示，过期自动隐藏，离开页面清除。不在 URL、日志或 localStorage 保存。

## 协议与扩展方式

`docs/API-V1.md` 是当前跨端协议说明，后端 route JSON Schema 执行输入校验，Web feature API 声明响应类型。当前响应类型尚未从 schema 生成；改协议必须同时更新服务端、Web 和 Android 接入计划及测试，不能只依赖 TypeScript 推断兼容。Android 接入时可以引入 `packages/api-contract` 的 OpenAPI 源定义与生成校验；在真正引入生成链路前不创建占位 package。

新增通知时建独立 notifications 模块，通过事务 outbox 消费已持久收件事件，不在收件路由里直接调用 Telegram。新增远程发件时建 commands 模块，实现领取/取消/过期和结果语义；不把 receive 的去重直接套到蜂窝 exactly-once。只有确有第二个消费者时才提取共享模块，不提前建立空泛的插件框架。

Android 已随 P1 接入分为 ui、connection、sync、telephony、data、platform，根包旧 Activity/Receiver 仅保留稳定组件名。SyncEngine 通过窄接口注入持久化和上传，JVM 可测；SyncRunner 负责 Android/HTTP 适配，JobService 负责调度生命周期。具体语义见 [Android P1](../apps/android/docs/P1-SYNC.md)。配对与上传代码已实现且已本地部署；真实短信端到端、断网补传、短时锁屏同步/心跳及重启恢复已有用户确认；长期待机及专项兼容仍待验证，见 P1-ACCEPTANCE.md。

## 验证与变更约束

后端接口回归覆盖鉴权、配对竞争、幂等与持久化；Web 模型测试覆盖异步会话与分组；浏览器验证真实登录、刷新、详情、退出及响应式；Compose 验证实际构建和重建持久化。演示数据只用于独立测试库，不上传真实短信。每次扩展记录已实现的端、兼容策略和未验证的真机行为。

SIM inventory and immutable message mapping: [SIM-MAPPING.md](SIM-MAPPING.md). API business ownership: modules/sims; Android observation: telephony/SimInventory; Web editing and labels: features/sims.
