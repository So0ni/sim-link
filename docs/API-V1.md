# API v1 · 服务端首个可运行切片

当前实现位于 `services/api`。同一服务托管 `/` Web 页面和静态资源；前端资源公开加载不赋予 API 权限，PWA 已接入持久登录、收件读取及配对管理。Android 核心真实收件链路已有真机验证，具体版本和未覆盖场景见 P1-ACCEPTANCE.md。默认传输为同源 HTTPS JSON；请求上限 128 KiB，JSON 字段严格校验。响应 `Cache-Control: no-store`。时间统一为 Unix 毫秒，所有错误为 `{ "error": "code" }`；401 表示身份失效、403 表示 Origin/CSRF 拒绝，网络错误不能被客户端解释为退出登录。

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

网页 GET `/api/v1/messages?after=0`（Cookie）返回 `{ messages, nextCursor }`，按 sequence 升序每页最多 100 条；每条包含 sequence/deviceId/eventId/sender/body/subscriptionId/receivedAt/syncedAt、simKey、isRead（boolean）、readVersion（非负整数）。nextCursor 使用不透明字符串处理；拉取至空页。本阶段为追加收件流，不实现搜索、删除、通知或发件；阅读状态另走下述独立增量流。Android 的本地 outgoing 记录不得通过本接口伪装为 incoming。

## 交付边界

- 已实现：本文件列出的服务端接口、数据库 v1、容器部署与测试。
- Android 已实现：服务器连接页、Keystore 凭证、绑定配对 generation 的持久 outbox、JobScheduler 及匹配 ACK 后确认。只上传配对后新短信，历史记录不迁移；待真机联调。
- PWA 已接入：真实登录/前台会话恢复、配对管理、读取收件流；跨浏览器已读/未读同步已接入；发件、通知和 iOS 真机体验待验证。
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

## SIM 清单与用户号码（0.3.0-p1）

能力 `sim.inventory`。设备 Bearer 鉴权 `POST /api/v1/device/sims`：

```json
{"status":"available","sims":[{"key":"00000000-0000-4000-8000-000000000001","subscriptionId":1,"slotIndex":0,"carrier":"Example Mobile"}]}
```

status 为 available / permission_required / unavailable；后两者 sims 必须为空。最多 16 项，key 与 subscriptionId 各自不能重复，key 为 36 字符小写 UUID 格式，slotIndex 从 0 开始。完整清单替换当前在用状态，历史记录保留；同一 key 不允许改变订阅编号或卡槽（409）。成功 `{ "ok": true }`。上报不会覆盖用户设置的名称和号码。

浏览器会话 `GET /api/v1/sims` 返回 `{sims:[{id,deviceId,simKey,subscriptionId,slotIndex,carrier,name,phoneNumber,state,reportedAt}]}`；state 为 active / inactive / unknown / detached，表示最后上报状态，不等于当前可发送。`PATCH /api/v1/sims/:id` 需 Origin/CSRF，body `{name,phoneNumber}`，备注 0–40 字符、号码输入 0–32 字符，规范化后可空或为可选 + 与 6–20 位数字。400 无效输入、404 记录不存在。号码不用于自动合并设备或历史数据。

设备收件接口增加可选 `simKey`，与事件其他字段一同参与重试冲突检查；提供 simKey 时 subscriptionId 不得为 null。浏览器消息返回 simKey（旧记录为 null）。设备列表增加 inventoryStatus、inventoryAt（未上报为 null）。映射与升级边界见 [SIM-MAPPING.md](SIM-MAPPING.md)。

## 安装身份与恢复（0.3.1-p1）

能力 `device.identity`；well-known 增加持久 `serverId`。配对请求允许可选 installationId（36 字符小写 UUID），响应增加 serverId。旧客户端不带 installationId 的新设备配对仍兼容。

- `POST /device/identity`：设备 Bearer；body `{installationId,deviceId,serverId?}`。deviceId 必须匹配凭证，已提供 serverId 必须匹配当前数据库。第一次通过有效旧凭证登记安装身份；响应 `{installationId,deviceId,serverId}`。错误凭证 401、身份冲突 409。重复同一登记幂等。
- `POST /devices/:id/pairing`：管理员 Cookie、Origin/CSRF，生成绑定指定设备的五分钟单次恢复邀请，响应沿用配对二维码格式。只能针对已配对设备或已登记的可恢复安装；不存在返回 404。
- `GET /devices/recoverable`：管理员会话；返回已解绑但保留安装身份的 `{devices:[{id,name}]}`，不包含有效凭证，不混入正常设备列表。

已知 installationId 使用普通邀请码返回 409，必须由管理员生成指定恢复邀请；不同 installationId 不得消费原安装的恢复邀请。成功恢复保留 deviceId、名称、SIM 与短信，轮换 token 并使其他恢复邀请失效。明确解绑取消未消费的恢复邀请，但保留安装恢复索引。完整语义见 [设备身份](DEVICE-IDENTITY.md)。

## 阅读状态（SQLite v5）

单管理员共享、按消息存储。旧记录和新收件均默认 `isRead=false, readVersion=0`，不猜测历史是否读过。与 Android 的系统已读、上传 ACK、送达无关；Android 上传协议和 ACK 不变，既有安装无需同时升级。旧 Web 可继续读取新增字段。

- GET `/api/v1/messages/reading?after=0`：Cookie 鉴权，返回 `{states:[{sequence,isRead,readVersion}],nextCursor}`。独立于新增短信游标，按全局递增 readVersion 升序，每页最多100项；只返回已修改消息的最新状态，不是审计日志。默认版本0由收件页携带，独立流不重复发出。游标校验同收件流；不从 PATCH 返回值推进轮询游标。
- PATCH `/api/v1/messages/reading`：Cookie + 同源 Origin + CSRF，设备 Bearer 不可用。请求 `{isRead:boolean,messages:[{sequence,readVersion}]}`，1–100个不同消息 ID。版本为调用者最后确认的版本，每项比较后更新。成功接受的项（包括同值写入）获得独立递增版本；过时项保持原状态。返回200 `{states:[...当前状态],conflicts:[...冲突消息ID]}`，可部分成功；客户端展示冲突并让用户确认后重试，不自动覆盖。重复ID/无效字段400；任一消息不存在404且整批不写。鉴权沿用现有401/403策略。
- 服务端事务持久化状态和全局时钟。重复收件不改变阅读状态。只更新明确列出的消息，新到消息不被旧请求整会话清空。
- Web 独立推进两个游标，各轮最多20页。分页间状态可再次前移，后续页仍能发现；客户端按每条消息版本合并，保留未加载消息的状态直到对应收件页到达，丢弃较旧响应。页签卸载取消请求并丢弃私密内存；写入结果不确定时由后续轮询校准。

升级前备份数据库及 WAL（或使用 SQLite backup）；不以旧服务打开 v5 数据库。新 Web 需要 v5 后端，同一容器构建部署；旧 Android 无需修改。

## P2 远程发送（2026-09-29，能力 `sms.send.v1`）

服务端SQLite v6，保留既有消息、阅读版本与会话。先升级服务端，再升级Android 0.4.0-p2/code9。旧Android不必同步升级：仍可收件，但发送能力默认关闭。新Android连接旧服务端时发送能力路由404会跳过远程发送，不影响原收件上传。无需修改既有heartbeat或SIM上报body。

浏览器端均使用已有持久会话；所有写请求需Origin/CSRF：

- `POST /api/v1/commands`：`{requestId,simId,recipient,body}`。requestId是调用方UUID，simId来自SIM清单，号码必须国际格式 `+[1-9][0-9]{6,14}`（去除空白、括号与短横线），正文1–1600字符且非全空白，旧版可选waitOffline布尔仍接受但忽略，不参与幂等内容比较。成功200返回命令。不可变目标包括deviceId、simKey、subscriptionId、slotIndex；服务器时间起1小时有效。发送能力必须已启用且SIM最后上报active；统一允许离线排队，不再要求60秒内的能力上报；普通heartbeat不代表可即时领取。409包括`idempotency_conflict`、`sim_unavailable`、`send_not_enabled`；400无效输入，429频率限制（每分钟30次）。同requestId相同规范化内容返回原命令，不续期；不同内容409。
- `GET /api/v1/commands`：`{commands:[...]}`，最近200条，按提交时间倒序。独立于收件sequence/阅读游标，不将发件标成入站或用户已读。当前无历史分页。
- `GET /api/v1/commands/request/:requestId`：查询原请求，404表示未找到。提交超时需先查询；若未找到且用户继续，重用原requestId及完全相同内容，不创建新键。
- `POST /api/v1/commands/:id/cancel`：只有pending可取消（已cancelled幂等），404不存在，409已领取或结束；领取/取消在数据库事务内竞争。设备撤销会取消尚未领取命令，保留历史。

设备端使用独立Bearer凭证，无浏览器Cookie：

- `POST /api/v1/device/send-capability`：`{enabled:boolean}` → `{ok:true}`。Android仅在当前配对已主动启用远程发送，且SEND_SMS/READ_PHONE_STATE已授予时上报true；否则false。设备列表增量字段sendCapability（0/1）、sendCapabilityAt（服务端时间）。重配会清零能力。
- `POST /api/v1/device/commands/claim`：`{requestId:UUID}` → `{command:null|命令,serverTime}`。Android在联网领取前持久化requestId，响应丢失重试同键只返回同一领取；新键不再领取已claimed的任务。仅领取本设备pending且未过期、目标映射active的命令；已变化映射记rejected/sim_changed。没有“租约超时重新入队”。空响应不绑定任务。
- `POST /api/v1/device/commands/:id/result`：`{claimRequestId,rejection,parts,interrupted}` → 命令。rejection为null或permission_required/sim_changed/expired/connection_changed/execution_interrupted；执行前确定未发送可拒绝。parts为最多32项整数或null，未拒绝时至少1项，-1为Android RESULT_OK，其他整数为系统发送失败码，null未收到结果。第一次确认的非空结果不可改，后续空值不撤销已有结果，长度不可改变；晚到回执可以完善未知结果。404非本设备/无命令，409领取键或结果冲突。interrupted标记调用边界异常，不触发重发。

命令返回：id、requestId、deviceId、simId、simKey、subscriptionId、slotIndex、recipient、body、createdAt、expiresAt、claimRequestId（未领取null）、claimedAt、reportedAt、serverTime、state、reason、parts、interrupted。所有API仍no-store。时间轴只展示服务端接收/领取/报告时间；没有伪造蜂窝提交或对端送达时间。

状态：pending等待手机；claimed只证明领取；领取后120秒无结果投影为unknown。pending超时为cancelled、reason=expired，后台每30秒清理，读取/领取时也检查截止时间，claimed不因过期冒充“未发送”。全部分段成功为sent，无送达报告；全部明确失败为failed，成功与失败混合为partial，其余为unknown；cancelled和rejected均表示未发送。既有任务保留原expiresAt，不延长历史任务；既有expired仍可读。过期检查同时在服务端领取与Android蜂窝提交前执行；Android以响应serverTime计算剩余时间，减去完整请求耗时与本机单调时钟经过时间，不依赖手机墙上时钟。

Android先持久化领取游标，再领取；收到命令后在同一事务保留不可重入执行记录并推进游标，随后校验配对、权限、逻辑SIM与有效期。每个分段先落盘再调用SmsManager。已有执行记录绝不再次调用蜂窝发送；重启只补报已存分段，没有本地发送记录的执行中断记拒绝。网络重传的是命令/回执，不是短信。不能承诺蜂窝exactly-once。
