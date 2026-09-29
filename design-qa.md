# Android 原生设计收敛 · 2026-09-29

final result: blocked

## 证据与验收范围

- Source visual truth: `design/vision/android-gateway-status-white-blue.png`、`android-connect-server.png`、`android-sms-setup.png`、`android-background-setup.png`、`android-sim-setup.png`、`android-connection-recovery.png`。
- 已打开视觉源图；运行状态源图 853 × 1844 像素。
- Implementation: `apps/android/app/src/main/java/dev/simlink/gateway/ui/` 原生实现，0.3.2-p1。
- Implementation screenshot / viewport / density normalization: 暂无。ADB 无设备，SDK 没有可用 AVD 或系统镜像。
- Full-view / focused comparison: 尚未进行，不能用代码检查代替渲染对照。

## 当前实现与有意调整

- 字体与层级：系统 sans，30sp 页标题、20sp 分组、16sp 正文、14sp 辅助信息；待真机核对换行。
- 间距与布局：20dp 页面边距、16dp 状态卡圆角、12dp 控件圆角、至少48dp触控；待360/390dp、大字体、安全区验收。
- 颜色：从共享 JSON 生成 Android color resources；白底、蓝色主操作、浅蓝选中面、语义警告。
- 图标：官方 Material Symbols 矢量，保留 Apache 2.0 来源。无位图素材需求。
- 文案：删除实验说明，未验证的在线/SIM可用状态不显示为成功；配对与同步配置分开表达。
- 不复刻概念稿的错误语义：不申请默认短信角色，不添加无功能的 SIM 开关，不将厂商设置显示为自动验证完成。

## 剩余验收

1. 连接 Android 设备，覆盖安装并核对运行、设置、权限、后台、SIM 页面。
2. 用不含真实短信、号码或凭证的界面截图，与参考图同尺寸并排比较。
3. 检查扫码/手动连接/失败恢复、键盘、返回手势、大字体与读屏标签。
4. 修正视觉差异后重新截图；首次渲染对照未完成，不能签署 passed。

## 工程检查

Debug 与 Release APK 构建、JVM 单元测试和 lintDebug 已通过；Lint 有现有依赖更新/资源等警告。无新的真实短信测试，不宣称已安装或通过视觉验收。
