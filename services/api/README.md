# SIMLink API · P1 服务端基础

Node.js 22+（容器 Node.js 24）、Fastify 5、better-sqlite3 / SQLite。单管理员、单进程、单数据库，无 Redis。当前提供登录、配对和收件接口；**PWA 已接入登录、收件与设备管理；Android 仍是本地 P0 应用，尚未上传到此服务，远程发送和通知尚未实现。**

## Docker Compose 部署

在本目录运行：

```sh
cp .env.example .env
# 编辑 PUBLIC_ORIGIN，例如 https://sim.example.com，不带末尾斜杠。
docker compose up -d --build --wait
```

API 默认仅发布到宿主机 `127.0.0.1:8787`。已有 HTTPS 反向代理时，将该域名转发至这个地址（代理在其他容器时应通过共享 Docker 网络访问 `api:8787`，不要把容器 localhost 当宿主机）。服务不信任外部转发头，Origin 校验以 `PUBLIC_ORIGIN` 为准。

同一个镜像包含 Web/PWA 构建产物，由 Fastify 在 `/` 托管，API 使用 `/api/v1/*`；无需部署第二个前端服务。镜像使用仓库根目录作为构建上下文，Compose 已配置好；手动构建使用 `docker build -f services/api/Dockerfile .`（在仓库根运行）。

容器不提供 HTTPS 代理、不监听宿主机 80/443。现有主机代理将整个域名（包括页面、静态资源和 API）转发到 `127.0.0.1:8787`，证书与端口复用由主机管理。不要给私有 API 添加公共缓存。使用独立域名根路径，当前不支持挂载在 `/simlink/` 子路径。

当前根页面为真实登录与收件入口。页面外壳可公开加载，短信接口必须通过真实服务端鉴权；虚构原型只存在于显式 demo 构建。公网设备连接必须通过现有代理的 HTTPS。

初始化唯一管理员（密码至少 12 字符）。下面适用于 Bash；输入隐藏，不进入命令历史、Compose 文件或环境变量：

```bash
read -r -s -p '管理员密码: ' simlink_password
printf '\n'
printf '%s' "$simlink_password" | docker compose exec -T api node src/admin.mjs
unset simlink_password
```

macOS 默认 zsh 可改用 `read -r -s 'simlink_password?管理员密码: '`，其余命令相同。初始化命令只允许执行成功一次；没有公开注册、默认密码或网页初始化后门。尚未提供密码重置流程，发布前需要补齐，不能删除数据库来冒充安全的重置操作。

浏览器登录接口、会话恢复及配对流程见 [接口契约](../../docs/API-V1.md)。工程模块划分见 [架构说明](../../docs/ARCHITECTURE.md)。

## 本地开发

```sh
npm ci
npm test
# 先按上面的隐藏输入方式取密码，再使用：
printf '%s' "$simlink_password" | npm run admin:init
unset simlink_password
PUBLIC_ORIGIN=http://localhost:8787 ALLOW_INSECURE_LOCAL=1 npm start
```

HTTP 开关仅接受 localhost / 回环地址；不允许用于局域网手机或公网。正常 HTTPS 使用 `__Host-simlink` Secure/HttpOnly Cookie；本地 HTTP 使用不同 Cookie 名。`HOST` 默认 127.0.0.1，`PORT` 默认 8787，`DATABASE_PATH` 默认 `./data/simlink.sqlite`。容器内部监听 0.0.0.0，由 Compose 限制宿主机发布地址。

## 数据、升级与备份

`simlink-data` 持久卷保存管理员密码摘要、网页会话摘要、设备凭证摘要、配对令牌摘要和短信。短信正文目前以明文存于 SQLite；限制宿主机和备份访问权限。请求正文、Cookie、Authorization、配对凭证均不写应用日志；反向代理也不要启用这些内容的日志。

普通 `docker compose restart` / `down` / 重建容器保留数据库，**`down -v` 会删除数据**。升级前备份，后运行 `docker compose up -d --build --wait`。数据库通过 `user_version` 迁移；较旧代码拒绝打开更高版本数据库，不自动降级。

离线一致性备份（先停止写入，保留 SQLite 主库和 WAL 文件一起）：

```sh
mkdir -p backups
chmod 700 backups
docker compose stop api
backup_name="simlink-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose run --rm --no-deps --entrypoint tar api -czf - -C /data . > "backups/$backup_name"
docker compose start api
chmod 600 "backups/$backup_name"
```

这些备份包含私密数据；转移离机前需加密。恢复到同版本测试实例时先停止 API，再将备份解包到该实例的 `/data` 卷，保持 UID 1000 可读写，然后启动检查。不要将未经验证的恢复直接覆盖唯一生产卷。网页会话与设备令牌恢复后仍有效，泄漏备份应按凭证泄漏处理。

本阶段尚未实现自动保留期清理、管理员密码重置、设备心跳、阅读状态、SIM 永久身份、推送。短信暂保留至手动运维删除；不能宣称已实现计划中的默认 30 天清理。正式接入真实短信前须在管理体验中明确当前保留策略。

## 验证

`npm test` 使用虚构短信，覆盖鉴权隔离、CSRF/Origin、持久会话与撤销、配对竞争/过期/限流、幂等重放/冲突、设备撤销、游标与重启持久化。Compose 使用独立测试项目验证构建、健康检查、初始化和容器重建后的登录/收件状态，不代表 Android 或 iOS 已联调。

选型参考：[Fastify 服务配置](https://fastify.dev/docs/latest/Reference/Server/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)。依赖精确版本与 lockfile 入库；容器基础镜像跟随 Node.js 24 安全更新，发布构建应记录实际镜像 digest。

2026-09-29 实测：`npm test` 8/8 通过；`npm run test:compose` 通过（初始化、登录、配对、入库、强制重建容器、会话恢复与重复上传）。测试自动清理独立项目及虚构数据。此为上一轮验证；目前已移除 Caddy，公网 HTTPS 由主机代理管理。

合并部署验证：`npm test` 9/9 通过，包含静态页面、SPA 导航、私有 API 鉴权、缺失资源与隐藏文件边界。`npm run test:compose` 已通过，同时验证镜像中的页面和 JS/CSS 资源、私有接口拒绝未登录访问，以及容器重建后的会话与短信持久化。独立前端开发仍可使用 Vite；本地后端要托管构建页面，先执行 `npm --prefix ../../apps/web run build:client`，再设置 `WEB_ROOT=../../apps/web/dist/client` 启动服务。

模块化接入验证：后端 9 项测试、Web 9 项模型/会话测试、4 项 Sites 兼容检查及 Compose 重新构建/持久化检查通过。Web 使用实际 API 和独立虚构测试数据完成浏览器登录、刷新恢复、收件详情与退出验证；Android 和 iOS 真机闭环仍未完成。
