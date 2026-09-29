# 发布与开源准备

当前为 Alpha，尚未配置公开远程仓库，也未发布正式签名 APK / 公共容器镜像。这里记录可复用步骤，私人环境、签名文件和会话交接记录保留在仓库外。

## 当前准备情况

- [x] MIT、自有代码与第三方资产说明。
- [x] 根 README、贡献、安全、隐私和更新记录；Issue / PR 模板。
- [x] 当前树排除交接文档、运行数据和原始 QA 截图；公开截图使用人工复核的虚构数据。
- [x] CI 定义 API / Web / Android 检查及隔离 Compose 验证；Actions 固定 commit SHA，Dependabot 定期更新。
- [ ] 私人 Git 历史清理与作者邮箱确认。普通删除提交不会清除旧版本中的文件。
- [ ] 创建公开远程、启用私密漏洞报告和分支保护；实际跑通远程 CI。
- [ ] 完整第三方/传递依赖许可核对与发行包声明。
- [ ] 正式 APK 签名密钥、签名构建及升级安装验证。
- [ ] 真实手机 Push、远程发件与后台验收，升级及备份恢复演练。
- [ ] 管理员密码恢复功能；短信保留期管理另行排期。

尚未勾选的事项不能在 README、发布页或徽章中标为通过。Alpha 可以列出已知缺口；正式稳定版需完成对应验收。

## 私人历史与首次公开

当前本地历史仍包含早期交接与私人环境记录。公开前有两种方式：

1. 审核并改写待发布仓库的历史，移除私人文件、截图和地址；维护者确认作者邮箱是否公开。
2. 保留原仓库为私人开发档案，从当前审查后的树创建一个没有旧历史的新公开仓库。

不要直接推送未经审查的全部 refs，也不要认为 `.gitignore` 会清理已有历史。历史改写与新公开仓库创建均是独立操作；本轮未执行。发现真实凭证先撤销/轮换。

## 本地发布检查

按各模块 README 安装固定依赖并执行检查。工作流见 `.github/workflows/ci.yml`。`scripts/check-public-repo.py` 检查当前被跟踪文件、常见私钥/token 和文档链接，不代替完整历史扫描、图片复核或漏洞审计。

```sh
python3 scripts/check-public-repo.py
npm --prefix services/api test
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run test:sites
npm --prefix apps/web run build
apps/android/gradlew -p apps/android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease
npm --prefix services/api run test:compose
```

Compose 检查使用独立项目/临时数据，不要将测试脚本改为指向个人服务的数据卷。发布前从干净 clone 按公开步骤重建；不能依赖本地 `node_modules`、SDK 路径或未跟踪脚本。

## APK 与容器发行

当前 Gradle 的 Release 构建未配置签名，产物不能作为正式可安装包宣传。建立正式签名流程时：

- 密钥离线生成并备份，密码与密钥通过受保护的构建环境提供，不写进 Git、命令参数或日志。
- 固定 applicationId，递增 versionCode，保留同一签名身份；已装 Debug 包不能假定能直接覆盖为正式签名包。
- 用 `apksigner verify --verbose` 验证签名，安装验证权限、配对及升级后的数据保留，再发布 APK 和 SHA-256。
- 容器先验证支持的目标架构，再发布有版本号的镜像及 digest，不宣称未构建/测试的架构可用。
- 附第三方许可、兼容矩阵、数据库版本、升级与回滚说明；不把 Debug 产物当正式发行版。

## 升级、备份与恢复

按 [后端 README](../services/api/README.md) 创建停写一致性备份。升级前记录镜像版本和数据库 `user_version`；降级旧服务不能直接读取新版本数据库。

恢复演练使用独立新卷：停止测试服务，将备份（含 WAL）解包至该卷，确认 UID/GID 和权限，用备份对应版本启动；检查完整性、短信数量、设备、会话以及推送身份，再验证升级。恢复后凭证仍可能有效，演练环境不应联系真实 Android 或投递真实通知。完成演练后只清理演练卷，保留源备份和生产卷。

## 本轮本地验证记录（2026-09-29）

API 29/29、Web 30/30、Sites 4/4，Web typecheck/build 通过；Android JVM 检查、lintDebug、Debug/未签名 Release 构建通过；隔离 Compose 构建、鉴权、配对、收件、发件 mock、容器重建持久化检查通过。Docker 发行内容已增加项目许可证与第三方说明。

当前树检查及其临时仓库反例（交接文件、断链、私钥标记）通过；CI YAML 已解析，Actions 引用核对官方远程 tag 对应 commit。未在 GitHub Runner 执行，不称为远程 CI 已通过。没有修改生产服务或使用真实短信。
