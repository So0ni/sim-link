# API v1 · 服务端首个可运行切片

当前实现位于 `services/api`。同一服务托管 `/` Web 页面和静态资源；前端资源公开加载不赋予 API 权限，PWA 已接入持久登录、收件读取及配对管理。Android 已实现配对/上传代码但未真机联调，不能据此宣称真实短信端到端完成。默认传输为同源 HTTPS JSON；请求上限 128 KiB，JSON 字段严格校验。响应 `Cache-Control: no-store`。时间统一为 Unix 毫秒，所有错误为 `{ "error": "code" }`；401 表示身份失效、403 表示 Origin/CSRF 拒绝，网络错误不能被客户端解释为退出登录。

## 登录与会话

单管理员由容器/本地 CLI 一次性创建，无公开注册。浏览器写请求必须携带与 PUBLIC_ORIGIN 完全相符的 `Origin`；除登录外还须带会话 Cookie 和 `X-CSRF-Token`。不启用跨域 CORS。

| 方法 / 路径 | 输入 | 输出 / 行为 |
| --- | --- | --- |
| GET `/.well-known/sim-gateway` | 无 | name、apiVersion=1、serverVersion、capabilities=[sms.receive] |
| GET `/healthz` | 无 | status=ok，仅存活检查，不证明管理员或设备就绪 |
| POST `/api/v1/auth/login` | password（12–1024 字符） | csrfToken；设置持久 HttpOnly Cookie |
| GET `/api/v1/auth/session` | Cookie | id、expiresAt、csrfToken；不续期 |
| POST `/api/v1/auth/resume` | Cookie、CSRF、Origin | ok；前台恢复时调用，每日至多续期一次 |
| POST `/api/v1/auth/logout` | Cookie、CSRF、Origin | 撤销服务端会话，清除 Cookie |
| GET `/api/v1/auth/sessions` | Cookie | sessions：id、expiresAt、lastActiveAt |
| DELETE `/api/v1/auth/sessions/:id` | Cookie、CSRF、Origin | 撤销指定网页会话 |

90 天不活跃过期，会话摘要与期限存 SQLite，普通服务重启不退出。GET 轮询、设备上传均不续期。csrfToken 只存客户端内存，需要时通过 session 恢复；不得将 Cookie 或设备凭证写入前端 localStorage。登录全局限流每分钟 10 次（单管理员初版，失败和成功均计数）；不依赖不可信 X-Forwarded-For。会话显示名和精确最近使用时间尚未实现，lastActiveAt 是最近一次续期时间。

## 配对和撤销

1. 已登录网页 POST `/api/v1/pairings`（CSRF/Origin），获得 `{ pairingToken, expiresAt, server, apiVersion: 1 }`。有效 5 分钟，一次性，令牌 256 位随机，不是短数字码。Web 本地生成配对二维码；也保留手动输入完整令牌。
2. Android 确认服务器域名后 POST `/api/v1/device/pair`：`{ pairingToken, name, apiVersion: 1 }`，获得 `{ deviceId, deviceToken, apiVersion: 1 }`。原子消费令牌；重复/过期均返回 400 pairing_invalid_or_expired，避免泄漏额外信息。
3. 配对请求全局每分钟 20 次；创建令牌每分钟 10 次。限流记录持久化，重启不清空；满额返回 429 try_later，客户端等待至少一分钟再试。
4. Android 用受保护存储保存 deviceToken，之后请求带 `Authorization: Bearer <deviceToken>`。浏览器会话与设备令牌不能互用。
5. GET `/api/v1/devices`（Cookie）列出 id/name/createdAt/revokedAt；DELETE `/api/v1/devices/:id`（CSRF/Origin）立即撤销设备后续上传，保留已有短信。

配对响应丢失时，令牌可能已消费；重新生成配对令牌，管理员可撤销遗留设备。服务端不保存可恢复的明文设备令牌，也不把永久凭证放入 URL。

## 收件持久化协议

Android 必须先本地持久化事件及 eventId，再上传；网络重试携带完全相同的 eventId 与字段。POST `/api/v1/device/messages`（设备 Bearer）：

```json
{
  "eventId": "example-local-event-uuid",
  "sender": "Example",
  "body": "Fictional message",
  "subscriptionId": 1,
  "receivedAt": 1790640000000
}
```

字段：eventId 1–128 字符；sender 1–256 字符；body 0–32768 字符；subscriptionId 非负 32 位整数或 null（未知）；receivedAt 非负整数且不超过服务端当前时间 5 分钟。时间偏差失败需修复时钟，不擅自改写原收件时间。subscriptionId 仅为设备当次观测，不是永久 SIM 身份，不用于跨换卡远程发件。

提交 SQLite 事务后才返回 `{ eventId, sequence, syncedAt, duplicate }`；Android 仅收到匹配 ACK 后标记已同步。同设备同 eventId 同内容返回原 ACK（duplicate=true）；字段变化返回 409 event_conflict，不覆盖旧正文。不同设备事件 ID 空间独立。401 停止重试并提示重新配对；400/409 保留队列并提示处理；网络/5xx 可退避重试，不丢弃事件。换服务器时旧队列不得自动迁移。

网页 GET `/api/v1/messages?after=0`（Cookie）返回 `{ messages, nextCursor }`，按 sequence 升序每页最多 100 条；每条包含 sequence/deviceId/eventId/sender/body/subscriptionId/receivedAt/syncedAt。nextCursor 使用不透明字符串处理；拉取至空页。本阶段为追加收件流，不实现搜索、已读、删除、通知或发件。Android 的本地 outgoing 记录不得通过本接口伪装为 incoming。

## 交付边界

- 已实现：本文件列出的服务端接口、数据库 v1、容器部署与测试。
- Android 已实现：服务器连接页、Keystore 凭证、绑定配对 generation 的持久 outbox、JobScheduler 及匹配 ACK 后确认。只上传配对后新短信，历史记录不迁移；待真机联调。
- PWA 已接入：真实登录/前台会话恢复、配对管理、读取收件流；跨端已读、发件、通知和 iOS 真机体验待验证。
- 真机下一步：明确选择测试后端，验证断网补传、重启和去重；不能把接口测试当成真实短信闭环。
- 用户已决定：当前小米发送确认框仅记录为机型限制，不继续专门适配或调查，不阻塞 P1。


内网调试例外：服务端显式 ALLOW_INSECURE_HTTP=1 可接受指定 HTTP PUBLIC_ORIGIN；Android 仅 Debug APK 在用户显式选中后接受 HTTP，Release 仍强制 HTTPS。HTTP Cookie 不带 Secure，Origin/CSRF 与接口鉴权保持不变；详细配置见服务端 README。


## 配对二维码 v1

二维码为 UTF-8 JSON 文本，不是 URL，不包含长期 deviceToken：

```json
{
  "type": "simlink.pairing",
  "version": 1,
  "apiVersion": 1,
  "server": "https://sim.example.com",
  "pairingToken": "<43-character-base64url-token>",
  "expiresAt": 1790000000000
}
```

expiresAt 为 Unix 毫秒，以配对接口返回值为准。Web 五分钟到期后移除展示；隐藏二维码不等于撤销尚未使用的配对码。Android 限制载荷 4096 字符，校验类型、版本、origin、令牌和过期时间，扫描只填表；用户确认目标地址后才连接。HTTP 仍需 Debug 手动同意，Release 拒绝。相机扫描由 ZXing 在设备本地完成，无外部二维码生成服务。


### 凭证生命周期说明

`pairingToken` 仅用于一次设备注册，服务端原子消费后生成新的独立 256 位随机 `deviceToken`，两者不是同一值。后续设备接口仅接受 `deviceToken`；服务器保存其 SHA-256 哈希，Android Keystore 加密保存原值。每个设备独立，可单独撤销。它是认证用 Bearer 令牌，不是双方消息加密密钥；服务器身份验证与传输加密使用 HTTPS/TLS。HTTP 调试不因持有 token 而获得加密。此版本未实现自动密钥轮换或应用层双向签名。


## 心跳与解除配对（API v1 增量）

`POST /api/v1/device/heartbeat`：设备 Bearer 鉴权，JSON `{}`，返回 `{ receivedAt }`（服务器 Unix 毫秒）。不接收客户端时间，不含短信正文。成功收件上传（含幂等重放）也更新最近联系时间。

`GET /api/v1/devices` 新增 `lastSeenAt`（可空）、`presence`（unknown/online/offline）、`serverTime`。从未收到心跳/短信为 unknown；35 分钟内有联系为 online，否则 offline。状态是最近联系推断，不保证设备此刻可达。旧客户端字段仍兼容，`revokedAt` 在有效设备列表中为 null。

`POST /api/v1/device/unpair`：设备 Bearer 鉴权，JSON `{}`，返回 `{ ok: true }`；删除该设备凭证与设备条目，保留短信。重复请求返回 401，Android 视为凭证已经失效，继续清除本机配置。管理端 `DELETE /api/v1/devices/:id` 同样移除条目并保留短信。

SQLite v2 为设备添加 last_seen_at，并将短信来源 ID 改为独立历史标识（不再外键依赖有效设备表），保留消息序号和游标；迁移删除 revoked_at 非空的旧设备。后端不能推断旧版只在本机解绑的设备，需由管理员移除。上线前备份；v1 服务器不能直接打开 v2 数据库。


Web 收件流继续使用游标增量轮询，无新接口：可见且联网时，每次请求完成约 5 秒后再请求；每轮最多 20 页，隐藏暂停，重新可见/联网立即检查。请求失败保留游标、列表和登录态（401 除外），退避最长 60 秒。此机制不提供后台系统通知，不表示已实现 Web Push。
