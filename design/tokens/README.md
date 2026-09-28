# Token 用法

[tokens.json](tokens.json) 是单一可机读源，使用项目自己的简单 JSON 格式，未声明兼容 DTCG 或任何生成工具。数值以逻辑尺寸记载，平台映射由消费端完成；不得把 dp、sp 与物理像素混用。

| 类别 | Web | Android |
| --- | --- | --- |
| color | CSS 自定义属性，如 --color-primary | Compose 语义色或资源色 |
| space / radius / size | CSS px；文字放大时容器自适应 | dp，触控区至少 48dp |
| type | size/16、lineHeight/16 转 rem，基准根字号不锁死 | size 转 sp，lineHeight 转 sp |
| font | 系统字体栈，不强制下载中文字体 | 系统 sans-serif/monospace |
| layout | CSS 媒体查询 + 实际容器宽度 | 原生布局按可用空间适配，不照搬桌面侧栏 |
| motion | 毫秒，遵守 prefers-reduced-motion | 毫秒，遵守系统动画偏好 |

Web 名称转换采用 camelCase → kebab-case，例如 surfaceSelected → --color-surface-selected。尚未生成 CSS/Kotlin 文件；后续生成物不得手工独立维护。色值含透明度时如 scrim=#17203366，Android 映射必须正确转换 RGBA 到所需表示，不可误当 ARGB。

首版用语义 token，不在业务页写 #0866E6 等常量。边框分为装饰分隔 borderSubtle 和交互控件 borderControl；弱分隔线不能作为输入框或状态唯一可见提示。disabled 采用明确字色/背景，不给整个组件随意降低透明度。

文字不低于 meta=13，重要正文 body=16；页标题 30，验证码 36，长候选码可换行或降到正文等宽展示，不能截断。图中的大字不机械照搬到所有页面。控件高度是最小值，大字号和双行按钮可以长高。

视觉外框可小于触控区，但相邻点击区不重叠；常规表单/按钮统一 48，独立图标 Web 至少 44，Android 至少 48。导航高度还需加平台安全区，不把 64px 当成包含安全区的固定高度。使用屏幕键盘时编辑器随可用视口调整。

默认无卡片阴影；仅遮罩层使用 scrim。悬停仅用于支持悬停的指针，触屏仍有按下反馈。焦点环使用 focusRing=2、focusOffset=2，不被 overflow 裁切；错误字段保留焦点环和错误文本。

内部对比度验收目标：正文/按钮文字至少 4.5:1，必要控件边界与焦点至少 3:1。见 [contrast-report.md](contrast-report.md)。这些是 token 组合检查，不能单独证明页面整体可访问性。
