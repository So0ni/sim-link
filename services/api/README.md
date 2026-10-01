# SIMLink API · P1 服务端基础

Node.js 22+（容器 Node.js 24）、Fastify 5、better-sqlite3 / SQLite。单管理员、单进程、单数据库，无 Redis。Web 已接入登录、收件、设备与 SIM 管理；Android 核心收件同步已通过真机验收。远程发送与新短信 Web Push 首版已实现，真机专项验收仍待完成。当前范围见 [计划](../../docs/PLAN.md)。

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

ALLOW_INSECURE_LOCAL 仅接受 localhost / 回环地址。内网 HTTP 调试另用显式 ALLOW_INSECURE_HTTP，配置见下节。正常 HTTPS 使用 `__Host-simlink` Secure/HttpOnly Cookie；本地 HTTP 使用不同 Cookie 名。`HOST` 默认 127.0.0.1，`PORT` 默认 8787，`DATABASE_PATH` 默认 `./data/simlink.sqlite`。容器内部监听 0.0.0.0，由 Compose 限制宿主机发布地址。

## 数据、升级与备份

`simlink-data` 持久卷保存管理员密码摘要、网页会话摘要、设备凭证摘要、配对令牌摘要和短信。短信正文目前以明文存于 SQLite；限制宿主机和备份访问权限。请求正文、Cookie、Authorization、配对凭证均不写应用日志；反向代理也不要启用这些内容的日志。

普通 `docker compose restart` / `down` / 重建容器保留数据库，**`down -v` 会删除数据**。升级前备份，后运行 `docker compose up -d --build --wait`。数据库通过 `user_version` 迁移；较旧代码拒绝打开更高版本数据库，不自动降级。

离线一致性备份（先停止写入，保留 SQLite 主库和 WAL 文件一起）：

```sh
mkdir -p backups
chmod 700 backups
docker compose stop api
backup_name="simlink-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose run -T --interactive=false --rm --no-deps --entrypoint tar api -czf - -C /data . > "backups/$backup_name"
docker compose start api
chmod 600 "backups/$backup_name"
```

这些备份包含私密数据；转移离机前需加密。恢复到同版本测试实例时先停止 API，再将备份解包到该实例的 `/data` 卷，保持 UID 1000 可读写，然后启动检查。不要将未经验证的恢复直接覆盖唯一生产卷。网页会话与设备令牌恢复后仍有效，泄漏备份应按凭证泄漏处理。

本阶段尚未实现短信自动保留期清理、管理员密码重置。短信暂保留至手动运维删除；不能宣称已实现计划中的默认 30 天清理。正式接入真实短信前须在管理体验中明确当前保留策略。

## 验证

`npm test` 使用虚构短信，覆盖鉴权隔离、CSRF/Origin、持久会话与撤销、配对竞争/过期/限流、幂等重放/冲突、设备撤销、游标与重启持久化。Compose 使用独立测试项目验证构建、健康检查、初始化和容器重建后的登录/收件状态，不代表 Android 或 iOS 已联调。

选型参考：[Fastify 服务配置](https://fastify.dev/docs/latest/Reference/Server/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)。依赖精确版本与 lockfile 入库；容器基础镜像跟随 Node.js 24 安全更新，发布构建应记录实际镜像 digest。

2026-09-29 实测：`npm test` 8/8 通过；`npm run test:compose` 通过（初始化、登录、配对、入库、强制重建容器、会话恢复与重复上传）。测试自动清理独立项目及虚构数据。此为上一轮验证；目前已移除 Caddy，公网 HTTPS 由主机代理管理。

合并部署验证：`npm test` 9/9 通过，包含静态页面、SPA 导航、私有 API 鉴权、缺失资源与隐藏文件边界。`npm run test:compose` 已通过，同时验证镜像中的页面和 JS/CSS 资源、私有接口拒绝未登录访问，以及容器重建后的会话与短信持久化。独立前端开发仍可使用 Vite；本地后端要托管构建页面，先执行 `npm --prefix ../../apps/web run build:client`，再设置 `WEB_ROOT=../../apps/web/dist/client` 启动服务。

模块化接入验证：后端 9 项测试、Web 9 项模型/会话测试、4 项 Sites 兼容检查及 Compose 重新构建/持久化检查通过。Web 使用实际 API 和独立虚构测试数据完成浏览器登录、刷新恢复、收件详情与退出验证；Android 和 iOS 真机闭环仍未完成。


## Android 内网 HTTP 调试

可以不部署 HTTPS 代理做内网联调。默认仍只监听宿主机回环，显式修改 `.env`：

```dotenv
PUBLIC_ORIGIN=http://192.168.1.10:8787
SIMLINK_BIND=192.168.1.10
SIMLINK_PORT=8787
ALLOW_INSECURE_HTTP=1
ALLOW_INSECURE_LOCAL=0
```

把示例 IP 替换为部署主机的实际 LAN 地址；浏览器与手机使用同一地址，然后运行 `docker compose up -d --build --wait`。Docker Desktop 若不能绑定指定主机地址，可用 SIMLINK_BIND=0.0.0.0 并通过主机防火墙限制内网访问。此开关不会自动关闭主机防火墙。

管理员初始化照前文执行。Web 登录 → 设备 → 生成配对二维码；Android **Debug APK** 打开“服务器与同步 → 扫码配对”，扫描后显式勾选内网 HTTP，再核对地址并确认。仍可手动输入地址与凭证。配对后再发送新的测试短信；旧本地短信不自动上传。

HTTP 将明文传输密码、设备凭证和短信，仅用于可信内网调试；Cookie 仍为 HttpOnly/SameSite，Origin/CSRF 仍校验，但没有 Secure。手机访问 localhost 是手机自身。HTTP 下剪贴板、安装型 PWA 和推送等安全上下文功能不作为调试验收条件；公网与 Release APK 使用现有主机 HTTPS 代理。


## 独立开发实例

开发与验收使用独立 Compose 项目、数据卷和虚构数据，不要把个人部署当成一次性测试库。固定项目名并在后续维护时保持一致；管理员密码仅在受保护的本地凭证管理工具中保存，不进入仓库。不要对已有数据卷执行 `down -v`。


## 小内存服务器：预构建镜像 + 现有 Tunnel

在开发机根据服务器架构构建（以下为 amd64），服务器只加载镜像，不安装编译依赖：

```sh
# 仓库根目录；使用本次实际版本替换 VERSION
docker buildx build --platform linux/amd64 -f services/api/Dockerfile -t simlink-api:VERSION-amd64 --load .
docker save simlink-api:VERSION-amd64 | gzip > simlink-image.tar.gz
```

把镜像归档及 `compose.prebuilt.yaml` 上传到指定部署目录，Compose文件可命名为 `compose.yaml`。服务器目录内创建权限600的 `.env`，设置 `SIMLINK_IMAGE=simlink-api:VERSION-amd64`、`PUBLIC_ORIGIN=https://实际域名` 和 `SIMLINK_PORT=8787`。然后执行：

```sh
docker load -i simlink-image.tar.gz
docker compose -p simlink up -d --wait
```

运行配置仅绑定 `127.0.0.1:8787`、限制256MiB内存并轮转日志。现有Cloudflare Tunnel若使用host网络，其路由服务地址为 `http://127.0.0.1:8787`；公网主机名必须与PUBLIC_ORIGIN一致。浏览器端使用HTTPS与Secure Cookie，Tunnel至同机回环使用HTTP，无需打开8787公网端口或另建代理。不要为该站点配置“Cache Everything”来缓存私密API。

SSH私钥只负责服务器登录，应用仍需按前文初始化独立管理员密码。默认新建独立持久卷，不自动迁移本机调试短信或手机绑定。更新镜像时保留同一项目名和卷，先备份；不要执行 `down -v`。公网HTTPS与登录最终验收需在域名路由生效后完成。

若SSH上传完整镜像过慢，也可从本机目标架构镜像导出 `/app`（包含已编译原生依赖及生产Web），打包后上传；远程从相同digest的官方Node基础镜像仅执行ADD/COPY组装。此方式不会在服务器运行npm、apt或编译器。必须核对归档SHA-256、基础镜像架构/digest，并在最终容器验证SQLite启动、认证和健康检查。远程部署目录应保留此次实际Dockerfile与归档用于复现。

## P2 迁移与兼容

SQLite v6新增commands及设备发送能力，保留旧消息、阅读状态和会话。先备份并升级后端，再升级Android 0.4.0-p2；旧Android继续收件但不开放远程发送。命令契约见[API v1](../../docs/API-V1.md)，隔离验证见[发送验收](../../docs/SENDING-ACCEPTANCE.md)。

回滚v6至旧服务不能只换镜像：旧服务拒绝更高schema；必须停服并按部署前一致性备份恢复数据库，且恢复会丢弃备份后新数据，先保留当前库。不要使用down -v。

## Web Push

SQLite v7 首次启动自动生成持久 VAPID 密钥，无需额外配置。数据库备份同时保护推送身份与订阅；不要重置密钥或输出订阅 endpoint。服务器需要出站 HTTPS 访问浏览器推送服务，无新增入站端口。设置页主动开启，默认包含发件人、不含短信正文。旧 APK 无需升级。队列、限流、重试及验收见 [Web Push](../../docs/WEB-PUSH.md)。升级前备份 v6 数据库；降级旧服务需使用升级前备份，旧版本不能直接打开 v7。

## 登录保护与可信代理

登录同一来源 15 分钟内累计失败 5 次后冷却 60 秒，之后再失败依次延长到 120、240、480、900 秒；冷却期间的请求不延长时间。成功登录清除该来源记录；已触发冷却的记录最后失败 24 小时后过期。IPv6 按 /64 聚合。同一 NAT 出口共享额度。另有全局每分钟 30 次校验和最多 2 个并行校验，已有登录会话不受影响。429 返回 `Retry-After`，PWA 显示倒计时。SQLite v8 持久化失败记录，升级前备份；旧版不能直接打开 v8。

`TRUSTED_PROXIES` 默认空，忽略转发头。反向代理部署时：

1. 确认 API 实际 TCP 对端地址，填写精确代理 IP（多个以逗号分隔），确需网段时使用最小 CIDR。仅支持地址/CIDR，不支持 true、跳数、0.0.0.0/0 或 ::/0。
2. 普通单层代理应覆盖 `X-Forwarded-For` 为实际客户端地址；多层代理应正确追加并仅信任受控链路，不能原样信任客户端自带的头。Cloudflare 会在 X-Forwarded-For 中追加访问者地址，按白名单从右向左解析。应用不直接信任 CF-Connecting-IP。
3. 本项目 host-network Tunnel → 主机回环映射端口 → Docker bridge 场景，容器看到的 TCP 对端可能是 Docker 网关，不一定是 127.0.0.1。可用 `docker network inspect <项目网络>` 核对网关，并用隔离测试确认实际链路；不要盲目信任所有私网或整个 Docker 网段。保证端口仅绑定回环，不允许公网或不可信容器绕过代理。
4. 在部署 `.env` 设置 `TRUSTED_PROXIES=<确认后的精确代理地址>` 后重建容器。两份 Compose 均传入该变量。未配置时保护仍生效，但代理后所有用户共用来源额度。

上线验收使用隔离账户/环境：来自两个来源的失败额度独立，伪造 X-Forwarded-For 不能绕过限制，429 剩余秒数递减，重启后冷却保留。不要对日常管理员账号做爆破测试。详细协议见 [API-V1](../../docs/API-V1.md#登录限流与代理sqlite-v8)。

参考：[Fastify 可信代理](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)、[Cloudflare 转发头](https://developers.cloudflare.com/fundamentals/reference/http-headers/#x-forwarded-for)。

## 网页登录设备管理（SQLite v9）

设置页可查询有效网页会话并逐个注销其他会话。v9 新增会话元数据，保留旧 Cookie 和 Android 凭证；旧会话初次登录时间无法回溯，显示“未记录”。最近访问在前台恢复时更新，不由后台轮询更新。注销会话一并移除其通知订阅及任务，不删除短信。

升级前备份数据库；较旧镜像无法打开 v9，回滚必须配合升级前备份。验收包括隔离环境的双会话注销、当前会话继续使用、撤销后不能续期及旧库迁移。


## 通知阶段诊断与未读总数（SQLite v10）

正文预览增量使用 SQLite v11，新增订阅 preview_length（默认 0）。部署前备份，先更新后端，再接受 PWA 更新；Android 无需升级。旧 Worker 忽略可选 preview 字段，旧后端下预览设置不可用。回滚到不支持 v11 的版本必须使用升级前备份。

新版本保留VAPID/订阅/队列并添加可空投递阶段时间；部署前备份。先升级后端（迁移v10），再让PWA用户接受应用更新；旧APK和旧Worker继续兼容。旧镜像不支持v10，回滚必须保留当前库后配合升级前备份，不能仅替换镜像。接口见[API契约](../../docs/API-V1.md)。

每5秒扫描最多20项、最多4路并发投递，HTTP请求使用10秒总截止信号取消，并声明high urgency；推送供应商和操作系统仍决定最终投递。设置页可查最近10项的受理/设备收到/显示调用完成，最后一项不等于用户看到。回报失败不影响通知显示，缺少回报不证明手机未收到。单体多进程并发仍不受支持。

## 来电增量升级

包含 `calls.receive.v1` 的版本启动时自动迁移至 SQLite v12，新增来电记录和最近状态表；先按原流程停服一致性备份，再升级后端/Web，最后升级 APK。旧 Android 短信接口保持兼容。备份同时包含来电号码；撤销设备不会删除历史来电。私密未接提醒复用现有 Web Push，不包含号码，超过一小时不补推。字段和限制见 [API v1](../../docs/API-V1.md) / [来电设计](../../docs/CALLS.md)。
