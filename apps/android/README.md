# SIMLink Gateway · Android

Android 14+ 原生 Kotlin 网关。已有本地短信收发实验，并加入扫码/手动配对、Keystore 凭证、持久收件队列和 JobScheduler 上传。单 application 模块；扫码采用 ZXing Embedded，连接页面采用 AndroidX Activity 接收扫描结果。模块与同步语义见 [P1 同步说明](docs/P1-SYNC.md)；核心收件已有真机验收；远程发件、长期后台和新版完整真机回归仍待完成。

## 工具链

- minSdk 34（Android 14）；compileSdk / targetSdk 37。
- Android Gradle Plugin 9.2.1，自带 Kotlin；Gradle Wrapper 9.4.1（分发文件 SHA-256 已固定）。
- SDK 平台安装包名为 `platforms;android-37.0`（Gradle 中仍为 `compileSdk = 37`）；SDK Build Tools 36.0.0；Java 源码目标 17。已用 Android Studio 自带 JBR 25 构建。
- 本机 SDK 路径写在被忽略的 `local.properties`，其他开发者自行配置 `sdk.dir`，或设置 `ANDROID_HOME`。

使用 Android Studio 打开本目录，等待同步。命令行需要将 `JAVA_HOME` 指向已安装的 JDK；例如本机 Android Studio 位于用户 Applications 目录：

```sh
export JAVA_HOME="$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK：`app/build/outputs/apk/debug/app-debug.apk`。仅为本机 debug 签名，后续正式发布需独立配置签名。

## 安装与使用

连接启用 USB 调试的手机并在手机上授权电脑，然后在 Android Studio 选择设备运行，或使用指定 SDK 的 `platform-tools/adb`：

```sh
adb devices -l
adb -s DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s DEVICE_SERIAL shell am start -n dev.simlink.gateway/.MainActivity
```

不要用 `-g` 或脚本自动授予短信权限。用户在手机“运行”页主动授权接收短信与读取 SIM；“发送”页单独申请发送权限。如果安装器或系统不允许授予受限制的短信权限，记录结果，不能通过绕过权限来宣称验证成功。

- **运行**：实际权限、当前活动 SIM、系统默认短信应用信息。
- **短信**：授权之后收到的新短信、本应用提交的发件、分段结果。长短信合并接收；同一订阅/PDU 摘要重复广播去重。列表只展示最近 100 条，历史数据仍在本地数据库。
- **新建**：显式选择订阅与卡槽、国际号码、正文；提交前重新检查卡槽/订阅存在。点击即真实发送，可能产生费用。
- **设置**：系统版本、实验范围、验证步骤与应用系统设置入口。

## 当前实现的可靠性边界

收件写入应用私有 SQLite；发件在调用 `SmsManager` 前持久化每个分段，独立、一次性的 PendingIntent 接收结果，重复回调不覆盖首次结果。没有自动重发、启动后补发或超时重试。

只有全部分段 `RESULT_OK` 才显示已发送。部分成功与失败并存显示部分发送；缺少回调超过 2 分钟或调用边界异常显示结果未确认，晚到的完整回调可以更新状态。两分钟只是本地“未确认”展示阈值，不是运营商超时或命令过期。没有请求送达报告，所以已发送不表示已送达。

应用不访问系统历史短信库、不写系统 SMS Provider、不接管默认短信角色，也不承担 MMS/RCS 或电话音频能力。可选的新来电记录同步见下文。非默认应用由系统负责 SmsManager 发件的系统库写入。本地记录只有收到匹配服务端 ACK 后才标为已同步。

接收广播若携带订阅信息则记录；缺失时写“SIM 归属未知”，不猜默认卡。subscriptionId 仅作为 P0 当次系统证据，不能作为未来后端的永久 SIM 身份；持久SIM映射和远程发件执行记录现已实现，见下文P2；收件outbox继续保留。

短信内容不写日志或提交文件；本地私有数据排除云备份及设备迁移。数据库尚未加应用层加密。默认短信应用继续负责通知。草稿只在当前进程/界面状态中保存，不承诺进程被杀后恢复。

## 为什么本轮不申请默认短信角色

P0 先测非默认应用路线，避免在没有实现默认角色完整职责时接管日常短信。该路线不能承诺所有验证码均可接收；带 SMS Retriever hash 的消息存在分发限制，较新系统还需单独验证。若目标机实测不满足需求，下一步独立实现默认角色要求的本地短信库、发送/通知及系统 Intent 职责，再评估取舍。

这不是将后续产品永久限定为非默认模式。默认角色、真实双卡归属、锁屏/重启/省电表现仍是 P0 验收项。

## 已知真机后台限制

小米 24115RA8EC / Android 16：首次锁屏测试中，系统短信收到但本应用没有收到；广播历史对本应用记录 `SKIPPED / Greezer Denial`，进程和短信权限仍正常。用户按“仅将 SIMLink 省电策略设为无限制”的指引复测后报告收件成功。此为单台设备的短时结果，不代表所有小米设备都需要或只需要这一项，也不保证过夜稳定。完整证据见 [验证记录](docs/P0-VALIDATION.md)。

## 检查与下一步

本机 HyperOS OS3.0.306.0.WOPCNXM 的两次发送测试均出现额外确认框，已定位为小米安全中心 `SendSmsVerificationActivity`；`SEND_SMS` 权限和标准 AppOps 已允许。手动确认后成功发出不代表支持无人值守发件。是否存在官方持续允许配置、默认短信角色是否改变此行为均未验证，详见 [验证记录](docs/P0-VALIDATION.md)。

- `./gradlew :app:testDebugUnitTest`：16 项发送、URL/HTTP 策略、同步幂等与取消测试。
- `./gradlew :app:lintDebug`：当前 0 错误；3 个建议为 Gradle 有更新版本、adaptive icon 的 v26 目录、确认是否必须具有电话硬件。固定官方 AGP 兼容版本且本实验依赖实体 SIM，暂保留并说明。
- `./gradlew :app:assembleDebug`：实际生成 debug APK。
- 真机测试按 [P0 验证表](docs/P0-VALIDATION.md) 执行，未执行的项不得标为通过。

官方依据：[AGP 9.2 兼容表](https://developer.android.com/build/releases/agp-9-2-0-release-notes)、[短信广播](https://developer.android.com/reference/android/provider/Telephony.Sms.Intents)、[SmsManager](https://developer.android.com/reference/android/telephony/SmsManager)、[默认短信职责](https://developer.android.com/reference/android/provider/Telephony)。

## P1 连接与同步

运行/设置 → 服务器与同步。先测试地址，再输入 Web 设备页生成的一次性配对凭证并确认地址。只有配对之后新收到的入站短信自动入队；旧记录和原服务器队列不迁移。可以刷新实际队列状态、请求同步、修正问题后重试 blocked 事件或解除本机配对。解除后请到 Web 撤销服务端凭证。

Debug APK 可勾选内网 HTTP 调试；Release 仍强制 HTTPS，普通证书验证不变。详细后端配置见 [后端部署说明](../../services/api/README.md)。HTTP 未加密，不把它用于公网真实数据。

本轮 Debug、未签名 Release 构建和 JVM 检查通过；release APK 不是可直接安装的正式签名发行版。该阶段的数据库 v2 迁移/Keystore/JobScheduler 和页面操作当时尚待在线真机；后续已完成公网部署与模拟器收件；本段是当时的构建记录。

### SIM 清单（0.3.0-p1）

使用已有读取 SIM 权限上报卡槽、订阅与运营商，并在收件时固定本地映射。数据库 v3 保留旧队列，旧记录不猜测卡归属。先升级后端再升级 APK；本地映射、号码命名及兼容规则见 [SIM 映射](../../docs/SIM-MAPPING.md)。号码由用户在 Web 设备页手动填写，不增加 READ_PHONE_NUMBERS 权限。

### 安装身份与地址迁移（0.3.1-p1）

本地数据库 v4 持久化 installationId 与已验证的 serverId。服务器与同步提供「修改服务器地址（保留配对）」；仅换 IP/域名使用此入口。Web 原设备的恢复二维码用于重新签发凭证；普通添加二维码不重复创建已知安装。队列保留条件及旧版本迁移见 [设备身份](../../docs/DEVICE-IDENTITY.md)。

### Native UI tokens

Android colors are generated from the shared design file. After changing colors,
run `python3 apps/android/scripts/generate-tokens.py` from the repository root.
`GatewayStyle` owns native components; `GatewaySetupPages` renders permission,
SIM and background configuration without network or message-store access.
Local test sending is accessible only in Debug via 设置 → 诊断与帮助 → 开发调试.

## P2 远程发送（0.4.0-p2/code9）

先升级服务端，再安装新版APK，原配对和数据保留。设置 → 短信与SIM权限 → 授权发送并“启用远程发送”；发送开关绑定当前配对，默认关闭。前台15秒检查命令，后台仍受系统15分钟调度和省电限制，Web提交统一排队1小时，Android按服务端expiresAt检查有效期；手机系统可能要求确认发送。

数据库v5持久保留领取请求键、执行记录和结果报告摘要；进程重启只补报，不再次提交蜂窝发送。发送前/调用边界前检查当前SIM和有效期；回执断网时本地分段结果保留，下一次同步补报。现阶段没有送达报告。Debug/Release、31项JVM测试与Lint通过；模拟器升级保留原虚构消息，实际蜂窝链路待用户指定SIM/号码验收，见[发送验收](../../docs/SENDING-ACCEPTANCE.md)。

## 短信触发加急同步（0.4.1-p2/code10）

收件入库后请求独立的加急 JobScheduler 任务；配额不足或请求被拒绝时回退普通任务，持久队列和 15 分钟周期补传保留。任务执行期间收到新短信会请求后续重试，避免只等周期补传。加急任务不保证秒级执行，也不能恢复被厂商拦截的短信广播。无需升级后端；覆盖安装保留配对和数据。

真机复测时可只采集不含短信内容的阶段日志：

```sh
adb -s DEVICE_SERIAL logcat -v time -s SIMLinkSync:I '*:S'
```

观察 SMS_RECEIVED → SMS_STORED → JOB_EXPEDITED_STARTED（回退时 JOB_STARTED）→ SYNC_STARTED → SERVER_ACK 的时间；无接收阶段时检查广播/厂商后台限制，有接收但无启动时检查调度，有启动但无确认时检查网络/同步。阶段不按消息标识关联，其他任务也可能产生同步/确认记录。长期锁屏、Doze、断网恢复与连续收件仍需真机验收；具体语义见 [同步说明](docs/P1-SYNC.md)。


## 上传快速重试（0.4.2-p2/code11）

只重试同一事件ID的收件上传：IO网络失败、HTTP 408/5xx最多追加两次，间隔2秒和5秒；429、携带Retry-After的HTTP响应、鉴权和数据错误不走快速重试。已有系统退避仍是持久兜底，不新增按Retry-After精确预约的保证。单条上传及其重试组设置30秒watchdog，触发后取消当前同步网络请求，队列等待后续调度。系统停止或配对generation改变时不继续发起重试；只有匹配ACK才确认本地记录。

这不是重新执行整个SyncRunner，也不调用SmsManager；身份/清单/命令准备失败仍交原系统重试。日志新增UPLOAD_RETRY固定阶段，无正文、号码或凭证。加急配额不足仍直接回退普通持久任务，不连续申请加急配额；后台时效继续受系统限制。0.4.2已覆盖安装小米24115RA8EC真机，现存配对与接口无需迁移；锁屏快速重试仍待专项复测。

## 0.4.4-p2 休眠同步兜底

新增每 15 分钟目标间隔的 setAndAllowWhileIdle 非精确单次闹钟，触发即重排下一次。先执行设备心跳，再在剩余窗口内直接复用完整同步（SIM 清单、发件能力/结果/命令、短信 outbox），无需等待普通任务启动。独立网络线程、整个唤醒共用 8 秒截止取消、最多 9 秒部分唤醒锁；SyncRunGate 保护所有完整同步入口，遇到正在运行的同步不等待并保留重试。未完成的工作通过原普通任务及下次闹钟继续，队列与命令持久化语义不变；不保证一次清空积压。不申请精确闹钟权限，仍可能被系统延后。保留周期同步兜底；开机和应用覆盖升级后恢复，解除配对取消，暂停连接在触发时停止重排。阶段日志仅记录时间、任务编号、停止原因和错误类别，不含号码、正文、地址或凭证。

## 新来电记录（0.5.0-calls）

先升级后端至含 calls.receive.v1 的 v12 schema，再安装新版 APK，保留配对和短信。设置 → 来电同步，正常授权通话记录和电话状态后主动启用；受限制权限无法授予时记录机型/安装器结果，不绕过。仅采集本次启用后的来电；关闭后保留已采集数据，重新启用继续上传原队列，但不补采关闭期间的来电。SIM 归属首版显示未知。

无网络的 Job 105 负责采集，系统 IDLE 广播触发延后/有限重查；现有启动、同步与心跳唤醒也补查。短信与来电共用任务 103（诊断阶段改为 INCOMING_SCHEDULE_REJECTED / INCOMING_EXPEDITED_REJECTED），队列与业务结构独立。来电权限/旧服务端接口故障不阻塞短信；UI 展示最近检查和待上传状态。构建命令不变。详见 [设计](../../docs/CALLS.md)、[模拟器验收及真机缺口](../../docs/CALLS-ACCEPTANCE.md)。

0.5.0-calls/code14 已覆盖安装至 Android 16 真机；安装成功不代表来电权限或自然后台采集已通过。模拟器证据、发布检查与真机缺口统一记录在上述验收文档中。
