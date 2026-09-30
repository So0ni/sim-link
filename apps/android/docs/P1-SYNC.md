# P1 · 配对与收件同步

实现版本 0.2.3-p1，最低 Android 14。当前完成代码、构建和 JVM 同步策略验证，并已通过 USB ADB 在用户的 Android 16 手机上升级安装、启动；本地 Compose 调试后端已部署。数据库迁移的数据保留、Keystore、JobScheduler、原生连接页面和真实短信闭环仍需进一步真机验证，不以安装启动成功代替。

## 模块归属

```text
ui/           MainActivity 本地运行/收发界面、ConnectionActivity 连接表单
connection/   地址规则、连接配置与加密凭证、HTTP 协议客户端
sync/         SyncEngine 纯业务协调、SyncQueue 持久队列、SyncRunner 适配、JobScheduler
telephony/    SMS_RECEIVED / SENT 回调、实体 SIM 发送、发送状态模型
data/         MessageStore / LocalMessage 与收件持久事务
platform/     GatewayDatabase 数据库版本、CredentialVault Keystore
```

根包保留 MainActivity、SmsReceiver、SentReceiver 薄包装类，以保持旧 APK 的 launcher/receiver 组件名和既有 PendingIntent 可解析。实际逻辑已迁入对应包。模块仍在一个 Gradle application 中，不为当前体量引入多工程或通用 DI 框架。

SyncEngine 不依赖 Android、JSON、网络或 SQLite，通过 SyncStorage 与上传函数注入依赖。JobService 只管理生命周期/取消，SyncRunner 将配置、队列和 HTTP 接到引擎。UI 不调用短信上传接口；接收器仅执行持久化与调度。数据层在同一事务里调用队列入库操作，不能先 ACK 接收再异步补建队列。

## 配对与隐私边界

运行或设置 → 服务器与同步：未配对提供扫码为主操作、手动输入为次操作；已配对显示维护概览，不要求再次输入一次性凭证。扫码后自动解析/检查服务器，HTTP Debug 先同意未加密连接；检查通过后显示完整地址和设备名称，确认后自动兑换并保存独立设备 token，再返回运行首页。服务端才是一次性码有效性的权威，不能把 checkServer 成功当成配对成功。相机首次请求，拒绝仍可手动；不保存照片、不上传图像、不依赖 Google Play 服务。

连接 UI 采用共享 GatewayStyle，与运行页统一白蓝配色、文字层级、48dp 控件与圆角状态面板。请求中禁用重复操作；失败停留，支持重新扫描；只有持久保存成功才返回。调度暂未接受时仍保留已成功配对状态并明确提示。维护页将重试、更换和解除收纳至更多选项，系统返回遵循页面层次。

设备 token 使用 Android Keystore AES-256-GCM 加密，AAD 绑定配对 generation、server 和 deviceId，密文存应用私有 SQLite。没有要求每次生物识别，以支持解锁后的后台工作；不承诺锁屏前尚未解锁即可工作。密钥不导出，备份/设备迁移继续排除私有数据。token、正文不写日志，配对码不进入 Activity 保存状态或 Autofill。

服务端配对码一次性消费；若响应丢失或本地保存失败，需重新生成配对码并在 Web 撤销遗留设备。解除配对先调用服务端 unpair，使凭证失效并移除设备条目；成功或返回 401 后清除本机配置。网络失败保留配置以便重试；在途请求可能已保存，历史短信保留。旧版仅本地解绑的遗留条目需在 Web 解除。

## 持久与重试语义

- SQLite v1 → v2 保留 messages/parts，新增 connection/outbox。历史记录不自动加入队列，配对成功后的新入站短信才在同一事务中写入 messages 与 outbox。发件记录永不上传到收件接口。
- 同一广播消息仍使用订阅+PDU 摘要作为稳定 eventId；重复入库忽略，不产生新事件。网络重试始终使用同一事件 ID 与正文。
- outbox 绑定不可变的本地配对 generation。更换服务器或重新配对创建新 generation，旧队列不迁移；列表显示“原配对队列已暂停”。当前没有旧队列重新绑定/导出 UI。
- 服务端 ACK 必须匹配 eventId，包含正 sequence 和非负 syncedAt，才将该事件标为 done。入库后 ACK 丢失保留 pending，由服务端幂等处理下一次上传。
- 401/403 暂停连接并要求重新配对；400/409 等将该事件标为 blocked，继续其他事件；408/429/5xx 和连接失败使用系统退避重试。用户修正时钟或服务器后可重试 blocked 事件，不改变原短信内容。
- 每次运行最多 40 条。即时任务和 15 分钟周期补偿任务均由系统调度；15 分钟不是实时 SLA。停止任务时断开当前请求，不将不确定请求标为成功。网络执行器独立于接收/本地 DB 执行器。
- JobScheduler 任务持久化，使用网络约束及指数退避；权限/厂商省电/强行停止仍可能限制运行。不实现常驻前台服务或隐藏重启，也不自动重发蜂窝短信。

### 0.4.1 短信事件加急同步

新收件事务完成后请求独立的持久加急任务（Job ID 103，`setExpedited(true)`），不设 minimum latency。普通即时任务 101 和周期任务 102 保留，避免已有心跳任务阻止短信加急调度。加急请求被系统拒绝时立即尝试注册普通持久任务；两者均失败时保留 outbox，记录调度失败，已注册的周期任务继续补偿。待运行任务可由新短信重新请求加急；正在执行的短信任务不被替换。

若短信在任务执行期间到达，完成时请求系统再次调度，覆盖最后一次队列读取与完成回调之间的竞态；这条补偿路径使用系统退避（初始 30 秒），不承诺即时重跑。失败重试与 15 分钟周期任务均不是实时 SLA，加急任务也受配额、网络及系统负载限制。沿用现有 ACK、配对隔离和远程命令幂等语义，无 API 或数据库变更，不要求后端同时升级。

`SIMLinkSync` 日志只记录固定阶段、手机墙钟和开机单调时间：`SMS_RECEIVED`、`SMS_STORED`、`JOB_EXPEDITED_STARTED` / `JOB_STARTED`、`SYNC_STARTED`、`SERVER_ACK`，另有加急拒绝、调度拒绝和任务停止。SERVER_ACK 表示匹配回执已交给本地队列确认；时间为手机观察到确认的时间，不是服务端时钟。日志不包含正文、号码、短信 ID/摘要、地址或凭证；批量收件只能观察阶段时间，不能按短信精确关联。此日志用于主动采集，不是持久审计记录。

广播若被厂商省电机制拦截，本应用无法生成 SMS_RECEIVED 或触发同步；仍需按真机记录检查 SIMLink 单应用后台设置。重启后首次解锁前、强行停止、长期锁屏仍不承诺可用。

## HTTP 内网调试

默认 HTTPS、默认系统证书验证，禁止跟随重定向传递设备凭证，不信任任意证书。地址只能是 origin，不能带 userinfo、路径、query 或 fragment。

Debug APK 显示“允许内网 HTTP 调试”复选框，选中后方可输入 HTTP，配对确认再次提醒未加密传输。Release 隐藏此入口，manifest usesCleartextTraffic=false；若升级后遇到历史 HTTP 配置，会暂停并要求 HTTPS 重新配对。

后端见 services/api/README.md 的内网调试配置。PUBLIC_ORIGIN 必须是手机和浏览器实际访问的地址；手机上的 localhost 指手机自己。HTTP 内网调试不代表支持 iOS PWA 安装、Web Push 或剪贴板等安全上下文能力。

## 验证历史与待测

以下为按版本保留的历史记录；当前汇总以 [P1 验收记录](../../../docs/P1-ACCEPTANCE.md) 为准。2026-09-29 用户已确认普通短信端到端及断网恢复补传均只有一条、正文完整。

2026-09-29 USB 真机检查：`adb install -r` 成功，已安装 versionCode 2 / versionName 0.2.0-p1；原有 launcher 组件冷启动返回 Status: ok，随后确认进程存在。RECEIVE_SMS、READ_PHONE_STATE、SEND_SMS 三项权限仍为已授予。未读取短信正文、配对服务器或上传短信；尚未人工确认页面显示与旧记录保留。

JVM 覆盖：地址校验/HTTP 显式启用、错误分类、ACK 匹配、ACK 丢失重试相同 ID、凭证撤销、单事件冲突、配对变化停止后续请求、停止任务不提前确认，加上原 6 项短信发送策略测试，共 16 项。

尚需真机：P0 升级保留记录，配对后收件→本地队列→服务端→PWA，断网补传且仅一条，JobScheduler 停止/恢复、锁屏/重启、Keystore 解密，HTTP debug 与 HTTPS release，各种重新配对/解除场景。本地调试环境已部署，上述完整链路待用户扫码与测试短信后确认。

2026-09-29 构建结果：Debug APK 与未签名 Release APK 生成成功，16/16 JVM 测试通过；Lint 0 错误、3 条建议（Gradle 更新、adaptive icon v26 目录、telephony 必需特性）。保留现有图标资源目录及固定工具链，不为建议扩大本轮变更。合并 manifest 检查确认 Debug cleartext=true、Release=false，连接 Activity 不导出，JobService 受 BIND_JOB_SERVICE 保护。后端 10 项测试和 Compose 重建检查通过；内网参数的 Compose 配置校验通过，未在局域网启动服务。


2026-09-29 扫码增量：0.2.1-p1（versionCode 3）已覆盖安装并冷启动成功。Web 二维码本地生成（qrcode.react 4.2.0），Android ZXing Embedded 4.3.0 + AndroidX Activity 1.10.1；相机可选，拒绝权限仍可手动输入。二维码按 API-V1 的版本化 JSON 解析，拒绝过期、错误类型/版本、非法 URL 和无效凭证，不把二维码当跳转 URL。Android 共 20 项 JVM 测试通过，Debug/Release 构建与 Lint 通过（0 错误、12 条建议）；Web 10 项测试、类型检查、构建通过。本地 LAN Compose 健康检查、Web 实际登录和二维码呈现通过；扫码识别及真机上传仍待确认。


0.2.2-p1：新增凭证分离回归验证（一次性码不能作为上传凭证、消费后不能再配对；独立 token 在配对码到期后仍可用；撤销仅影响目标设备）。后端 11 项测试通过。UI 的扫码自动检查、确认后保存并返回运行页已实现；本轮未自动消费真实配对码，真机完整流程需要操作验证。

0.2.2 真机交付：USB 覆盖安装成功，versionCode 4 / versionName 0.2.2-p1；启动命令返回 Status: ok，但结果指向当前小米应用详情页且未冷启动，不能据此确认新版页面显示。最终 Debug 构建、20 项 JVM 测试及 Lint（0 错误）通过。未通过镜像工具完成页面截图核验，未自动扫描或消费真实配对码；视觉与扫码后返回行为仍待用户真机确认。


### 0.2.3 心跳

沿用 15 分钟 JobScheduler 周期任务，配对后、回到前台、收到新短信也会请求即时任务。每次执行在收件队列之前发送一次认证心跳，空队列也发送；系统可能延迟执行，非精确闹钟。心跳 401/403 暂停同步，404 兼容旧服务器，暂时失败请求退避重试并继续尝试短信上传，不将心跳失败当作短信失败。当前心跳只提供联系证据，不上传电量、权限或正文。

Android 23 项 JVM 测试覆盖空队列心跳、心跳失败不阻断短信、闲置设备撤销和旧服务器兼容。解除配对在网络执行器中通知后端，再移除本机配置；服务器记录删除不删除短信，不重新绑定旧队列。

2026-09-29 真机心跳验证：0.2.3-p1 已 USB 升级安装。通过 `cmd jobscheduler run -f dev.simlink.gateway 102` 强制触发已注册周期任务，后端收到心跳，Web 设备页显示“在线 · 最近有联系”及服务器时间。此为真实设备/网络/凭证链路验证，不等同于自然周期、锁屏及省电调度通过；未执行真实设备解绑。后端 13 项、Android 23 项、Web 10 项测试通过，类型检查与 Debug 构建/Lint 通过。

### 0.3.1 安装身份与地址迁移

[设备身份规则](../../../docs/DEVICE-IDENTITY.md) 补充并更新上文的重新配对语义：经原凭证验证的地址迁移保留队列；恢复已知相同 serverId/deviceId 时保留 generation，跨后端仍不迁移。首次升级自动生成本地安装 ID，凭有效旧 token 登记现有服务端记录。


### 0.4.2 上传内有限重试

详见README的0.4.2说明。UploadRetry为可独立JVM测试的策略；只包裹幂等upload请求，不包裹远程命令执行。取消watchdog与JobService取消共用RequestCancellation，取消后SyncEngine保留未确认outbox。30秒是运行中发出取消的预算，不能推断系统一定会在该时间运行或后续任务一定及时启动。
