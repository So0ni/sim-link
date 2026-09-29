# 参与 SIMLink

欢迎围绕可靠短信闭环、易维护的自托管部署和清晰的跨端状态提交改进。较大功能先提 Issue 讨论范围；目前以单管理员、单体服务、Android 14+ 为边界。

## 开始开发

阅读根目录及所改模块的 `AGENTS.md`，再看模块 README。以代码、当前计划与验收范围共同判断状态；概念稿和历史记录不代表功能已完成。

使用独立测试数据库与虚构数据，不接入个人短信库。不要提交 `.env`、运行数据库、备份、管理员密码、推送 endpoint/密钥、APK 签名文件或真实短信截图。会话交接文档属于本地临时文件，不进入 Git；稳定需求、工程状态和可复用操作说明分别写入规格、计划与模块 README。

## 提交与验证

1. 保持改动聚焦，描述触发问题、预期行为和影响范围。
2. API、数据库或命令变化须说明迁移和旧 Android 兼容方式；不能要求所有设备同时升级。
3. 按实际改动运行相关模块检查：

```sh
npm --prefix services/api ci
npm --prefix services/api test
npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run test:sites
npm --prefix apps/web run build
# Android 需先按模块 README 配好 JDK 与 SDK
apps/android/gradlew -p apps/android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
python3 scripts/check-public-repo.py
```

4. UI 变化检查窄屏、桌面、键盘与错误状态；只将明确虚构且人工复核过的公开截图放入 `docs/images/`。
5. 在 PR 中说明完成的验证及缺口。模拟器、单测、编译通过均不能替代真实蜂窝或手机系统通知验收。

本地 QA 截图目录、私有运维档案和交接文件默认忽略。不要用 `git add -f` 绕过此边界。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。行为应保持尊重，围绕事实讨论，避免公开个人信息。
