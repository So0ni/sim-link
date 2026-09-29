# SIMLink Gateway · Android P1

Android 14+ 原生 Kotlin 网关。已有本地短信收发实验，并加入扫码/手动配对、Keystore 凭证、持久收件队列和 JobScheduler 上传。单 application 模块；扫码采用 ZXing Embedded，连接页面采用 AndroidX Activity 接收扫描结果。模块与同步语义见 [P1 同步说明](docs/P1-SYNC.md)；P1 尚未完成真机联调。

## 工具链

- minSdk 34（Android 14）；compileSdk / targetSdk 37。
- Android Gradle Plugin 9.2.1，自带 Kotlin；Gradle Wrapper 9.4.1（分发文件 SHA-256 已固定）。
- SDK Build Tools 36.0.0；Java 源码目标 17。已用 Android Studio 自带 JBR 25 构建。
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

应用不访问系统历史短信库、不写系统 SMS Provider、不接管默认短信角色，也不承担 MMS/RCS 或电话能力。非默认应用由系统负责 SmsManager 发件的系统库写入。本地记录只有收到匹配服务端 ACK 后才标为已同步。

接收广播若携带订阅信息则记录；缺失时写“SIM 归属未知”，不猜默认卡。subscriptionId 仅作为 P0 当次系统证据，不能作为未来后端的永久 SIM 身份；还没有持久 SIM 映射或远程发件队列；收件 outbox 已实现。

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

本轮 Debug、未签名 Release 构建和 JVM 检查通过；release APK 不是可直接安装的正式签名发行版。数据库 v2 迁移/Keystore/JobScheduler 和页面操作尚待在线真机；当前用户尚未部署后端。

### SIM 清单（0.3.0-p1）

使用已有读取 SIM 权限上报卡槽、订阅与运营商，并在收件时固定本地映射。数据库 v3 保留旧队列，旧记录不猜测卡归属。先升级后端再升级 APK；本地映射、号码命名及兼容规则见 [SIM 映射](../../docs/SIM-MAPPING.md)。号码由用户在 Web 设备页手动填写，不增加 READ_PHONE_NUMBERS 权限。
