# Outflow

轻量的多人协作知识库。文档**默认公开**，可以设为「仅登录可见」或「草稿」；支持多人实时协同编辑；同一份代码既能部署到 **Cloudflare Workers**（Serverless），也能用 **Docker / Node** 自托管。

- **后端**：Hono（API + 公开阅读页的服务端渲染）
- **前端**：Vite + React + TanStack Router（编辑器、登录注册、管理后台）
- **编辑器**：TipTap + Yjs 实时协作
- **存储**：SQLite（Cloudflare 上是 D1，自托管时是 Node 24 内置的 `node:sqlite`，无需原生编译），图片存 R2 或本地磁盘

## 功能

| 模块 | 说明 |
|---|---|
| 可见性 | `公开`（默认，所有人与搜索引擎可读）/ `仅登录可见` / `草稿`（仅作者与管理员）。子文档不会比父文档更开放：只要任何一级祖先不可读，子文档就不可读 |
| 协作 | 多人实时编辑，显示协作者光标和在线头像；匿名读者在阅读页会看到「文档已更新」提示 |
| 注册 | 必须通过邮箱验证码注册，并且只接受**白名单**内的邮箱，其余一律拒绝。白名单在发信前检查，不在名单内的邮箱不会消耗邮件额度 |
| 地域白名单 | 按请求来源国家/地区限制接口，默认只允许中国内地（CN）和香港（HK）注册；按范围配置（注册、登录与找回密码），可在管理后台随时调整。Cloudflare 上自动识别地区，自托管时可用上游代理传来的请求头或本地 IP 库（DB-IP Lite） |
| 防滥用 | 人机验证可切换：ALTCHA（自托管 PoW，默认；隐式运行，打开页面即在后台自动完成，只在顶部弹出提示）、Turnstile、hCaptcha；按 IP 和用户限流；登录默认每次都要人机验证（`LOGIN_CAPTCHA=after_failures` 可改为失败 3 次后才要求），失败 10 次锁定 15 分钟；验证码有冷却时间、尝试次数和每日上限 |
| 内容 | 集合 → 文档树（拖拽排序或嵌套）、版本历史（每 10 分钟一个快照，可回滚）、图片粘贴或拖入上传、导出 Markdown、搜索（对中文友好的子串匹配） |
| SEO | 公开文档由服务端渲染，并提供 sitemap.xml、canonical 和 og 标签；非公开文档自动 `noindex` |
| 评论 | 行内批注（选中正文文字即可批注，基于 Yjs 相对位置锚定，并发编辑后仍能定位原文；可回复、解决）与文末讨论；支持 @ 提及与链接自动识别；仅登录用户可见，所有角色均可评论，编辑及以上可删除他人评论 |
| 通知 | 被 @ 提及、讨论有新回复、自己的文档被评论、批注被解决时发送站内通知（不发邮件，邮件只用于验证码）。收件人必须能读到该文档 |
| 角色 | `成员`（默认，阅读登录可见的文档、评论）/ `贡献者`（新建文档，编辑、发布、移动、删除自己的文档）/ `编辑`（审稿：可修改、移动、删除他人的文档，新建集合）/ `管理员`。草稿只有作者和管理员能看到；只有管理员可以连同子文档一起删除 |
| 插件 | 学校相关的功能以插件形式接入（如校园地图），插件可以提供页面、顶栏入口、接口、文档页扩展区域和静态资源，数据存在宿主提供的键值存储中。见 [plugins/README.md](plugins/README.md) |
| 管理 | 白名单规则、用户角色与停用、集合管理、文档锁定（锁定后仅管理员可编辑） |

第一个注册的用户自动成为管理员。

## 快速开始（本地开发）

```bash
pnpm install
cp .env.example .env
# 在 .env 中填写 SESSION_SECRET（openssl rand -hex 32）
pnpm dev
```

打开 http://localhost:5173 。开发时在 `.env` 里显式设置 `MAIL_DRIVER=console`，邮件就不会真的发出，验证码直接打印在终端里，注册页也会给出提示。生产环境请配置 SMTP；什么都没配置时，发送验证码会直接报错，而不是假装发送成功。

`pnpm dev` 会同时启动：

- Node 服务，端口 8787：API、阅读页、WebSocket
- Vite，端口 5173：前端 SPA，动态路由代理到 8787

## 插件

Outflow 本身不包含任何学校的数据。把插件仓库克隆到 `plugins/<name>`，重新执行 `pnpm install`（或 `pnpm plugins`）后构建、部署即可启用；删除目录即可卸载。插件的编写约定见 [plugins/README.md](plugins/README.md)。

## 部署到 Cloudflare Workers

```bash
npx wrangler login
ALLOWED_EMAIL_DOMAINS="*.edu.cn" pnpm setup:cf
```

脚本会自动完成以下步骤：

1. 创建 D1 和 R2
2. 回填 `database_id`
3. 执行迁移
4. 构建前端
5. 部署 Worker
6. 生成 `SESSION_SECRET`

部署后，在 `server/wrangler.toml` 的 `[vars]` 中修改配置，然后执行 `pnpm deploy:cf`。机密项用 `npx wrangler secret put <NAME>` 设置（在 `server/` 目录下执行）。

用到的 Cloudflare 资源：Workers、Static Assets、D1、R2、Durable Objects（每篇文档一个协作房间）、Rate Limiting、Cache API。

本地模拟 Cloudflare 环境：

```bash
cd server && echo "SESSION_SECRET=$(openssl rand -hex 32)" > .dev.vars
npx wrangler d1 migrations apply DB --local
cd .. && pnpm dev:cf
```

## 自托管（Docker）

```bash
cp .env.example .env   # 填写 SESSION_SECRET、SMTP 等配置
docker compose up -d --build
```

国内网络可以加 `--build-arg NPM_REGISTRY=https://registry.npmmirror.com`，或在 compose 的 `build.args` 中设置。

数据保存在 `./data` 目录（SQLite 和上传的图片），备份时复制这个目录即可。如果部署在 Nginx、Caddy 等反向代理之后，需要设置 `TRUST_PROXY=true`，并让代理转发 WebSocket（路径为 `/api/collab/*`）。

使用地域白名单时，先在宿主机执行 `node scripts/geoip-download.mjs` 下载 IP 库（会保存到 `./data/geoip/`），再在 `.env` 中设置 `GEO_MMDB_PATH=/data/geoip/dbip-country-lite.mmdb`；如果前面套了 Cloudflare 代理，也可以改用 `GEO_COUNTRY_HEADER=CF-IPCountry`。

不用 Docker 的话（需要 Node 24+）：`pnpm install && pnpm build && pnpm start`。

## 配置项

完整说明见 [.env.example](.env.example)。Cloudflare 上对应 `wrangler.toml` 的 `[vars]` 和 secrets。

| 变量 | 说明 |
|---|---|
| `SESSION_SECRET` | **必填**，至少 16 个字符 |
| `ALLOWED_EMAIL_DOMAINS` | 注册白名单，用逗号分隔：`*.edu.cn`（任意子域）、`@pku.edu.cn`（精确域名）、`a@gmail.com`（单个邮箱）。管理后台可以再追加规则 |
| `REGISTRATION_ENABLED` | `false` 表示关闭注册 |
| `CAPTCHA_PROVIDER` | `altcha`（默认）、`turnstile`、`hcaptcha` 或 `none`。后两种第三方服务需要配置 `CAPTCHA_SITE_KEY` 和 `CAPTCHA_SECRET` |
| `LOGIN_CAPTCHA` | `always`（默认，每次登录都要人机验证）或 `after_failures`（连续失败 3 次后才要求） |
| `GEO_REGISTER_COUNTRIES` / `GEO_LOGIN_COUNTRIES` | 各范围允许的国家/地区代码，如 `CN,HK`；留空表示不限制 |
| `GEO_UNKNOWN` | 无法识别地区时 `deny`（默认）或 `allow` |
| `GEO_COUNTRY_HEADER` / `GEO_MMDB_PATH` | 仅自托管：地区来源，二选一。IP 库用 `node scripts/geoip-download.mjs` 下载 |
| `MAIL_DRIVER` | 留空自动选择（有 `SMTP_HOST` 用 smtp，有 `RESEND_API_KEY` 用 resend，都没有则无法发验证码）；`console` 只打印到日志，仅限开发 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP 配置。在 Workers 上必须用 465 或 587 端口 |
| `RATE_LIMIT_AUTH` / `RATE_LIMIT_WRITE` / `RATE_LIMIT_READ` | 自托管时的限流额度（每分钟次数，默认 10 / 120 / 300）；校园网共用出口 IP 时可调高 `RATE_LIMIT_AUTH`。Cloudflare 上改 `wrangler.toml` 的 `[[ratelimits]]` |
| `APP_URL` | 对外访问地址，用于 sitemap 和 canonical；以 `https` 开头时会自动给 Cookie 加 `Secure` |

## 目录结构

```
server/
  migrations/          SQL 迁移（D1 与 Node 共用）
  src/
    entry/worker.ts    Cloudflare 入口（导出 CollabRoom Durable Object）
    entry/node.ts      Node 入口（HTTP + WebSocket + 静态资源）
    adapters/          db / storage / mailer / ratelimit / cache 的 cf 与 node 两套实现
    collab/room.ts     与运行时无关的 Yjs 房间（兼容 y-websocket 协议）
    core/              权限、认证、评论、通知、验证码、搜索
    plugins/           插件宿主与服务端插件 SDK
    routes/            API 与服务端渲染页面
    views/             Hono JSX 视图与共享样式
web/                   Vite + React SPA
scripts/setup-cf.mjs   Cloudflare 一键部署
scripts/geoip-download.mjs  下载 DB-IP Lite IP 库（自托管时的地区识别）
scripts/smoke.mjs      API 冒烟测试（白名单、可见性继承、CSRF、渐进式验证码等）
scripts/plugins.mjs    扫描 plugins/ 生成插件注册表（install、dev、build、typecheck 前自动执行）
plugins/               插件目录（各插件独立维护，克隆到这里即可启用）
```

## 已知限制（MVP）

- 搜索用的是 `LIKE` 子串匹配，适合几千篇文档的规模；更大规模可以换成 FTS5 trigram
- Cloudflare 上的页面缓存只清除当前数据中心的副本（TTL 60 秒），其他数据中心最多延迟 60 秒更新
- 文档标题不参与实时协同（保存时以最后一次修改为准），正文是实时协同的
- 暂不支持 OAuth/SSO、多工作区、API Token

## 致谢

自托管时的地区识别使用 [DB-IP](https://db-ip.com) 的 IP Geolocation 数据（CC BY 4.0）。
