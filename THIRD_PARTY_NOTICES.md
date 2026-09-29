# 第三方组件与资产

SIMLink 自有代码使用根目录 MIT；第三方组件保留原许可证，不因本项目许可证改变。精确版本以各模块锁文件及 Gradle 声明为准；发行时应附带实际依赖所需的许可文本与版权声明。

## 直接 JavaScript 依赖

以下许可标识来自当前 npm 锁文件，不是完整的传递依赖审计：

| 组件 | 许可标识 |
| --- | --- |
| Fastify、@fastify/static、better-sqlite3 | MIT |
| web-push | MPL-2.0 |
| React、React DOM、React 类型声明 | MIT |
| @phosphor-icons/react | MIT |
| qrcode.react | ISC |
| Vite、@vitejs/plugin-react | MIT |
| TypeScript | Apache-2.0 |

服务端容器携带 npm 依赖目录中的上游许可证；Web 打包后的分发包仍需在发行前核对传递依赖及声明是否完整。不要将此表当作已完成 SBOM 或许可合规审计。

## Android 与视觉资源

- Android 使用 AndroidX Activity、ZXing Embedded 及其传递依赖；测试使用 JUnit 与 org.json。发布签名 APK 前核对解析后的依赖及上游许可。
- Material Symbols 图标来源及 Apache 2.0 文本见 [Android licenses](apps/android/licenses/README.md)。不得删除上游版权说明。
- Web 图标来自 @phosphor-icons/react；PWA 图标为项目内 SVG 与其生成的 PNG。
- `design/vision/` 是 Image Gen 生成的概念稿，来源记录见 [视觉方向稿](design/vision/README.md)。示例中的第三方名称不表示授权、合作或背书，不用作真实产品能力证据。
- `docs/images/` 是已人工检查的虚构数据界面截图；本地 QA 截图不随源码分发。
