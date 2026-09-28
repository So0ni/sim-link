# Token 对比度检查

2026-09-28，使用 tokens.json 中不透明 sRGB 色值计算相对亮度和对比度。只检查下列预期组合，不代表所有页面已通过可访问性测试。

| 前景 | 背景 | 计算结果 | 内部目标 | 结果 |
| --- | --- | --- | --- | --- |
| textPrimary | background | 16.27:1 | 4.5:1 | 通过 |
| textSecondary | background | 5.91:1 | 4.5:1 | 通过 |
| textMuted | background | 5.01:1 | 4.5:1 | 通过 |
| primary | background | 5.18:1 | 4.5:1 | 通过 |
| dangerText | background | 6.10:1 | 4.5:1 | 通过 |
| onPrimary | primary | 5.18:1 | 4.5:1 | 通过 |
| onPrimary | primaryHover | 6.50:1 | 4.5:1 | 通过 |
| onPrimary | primaryPressed | 8.14:1 | 4.5:1 | 通过 |
| onPrimary | dangerText | 6.10:1 | 4.5:1 | 通过 |
| successText | successSurface | 5.40:1 | 4.5:1 | 通过 |
| warningText | warningSurface | 5.92:1 | 4.5:1 | 通过 |
| dangerText | dangerSurface | 5.52:1 | 4.5:1 | 通过 |
| disabledText | disabledSurface | 5.17:1 | 4.5:1 | 通过 |
| textPrimary | incomingBubble | 14.63:1 | 4.5:1 | 通过 |
| textPrimary | outgoingBubble | 14.56:1 | 4.5:1 | 通过 |
| primary | surfaceSelected | 4.64:1 | 4.5:1 | 通过 |
| borderControl | background | 3.59:1 | 3:1 | 通过 |
| focus | background | 5.18:1 | 3:1 | 通过 |
| focus | surfaceSubtle | 4.83:1 | 3:1 | 通过 |

装饰分隔 borderSubtle 不用作控件唯一边界；scrim 为半透明遮罩，不能用于正文色。JSON 解析、颜色格式、行高不小于字号和常规控件最小高度同时通过。仍需在组件实现后检查实际字体、聚焦、键盘、触控与放大表现。
