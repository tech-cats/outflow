# AGENTS.md

给 AI Agent 的部署和开发说明。用户说「部署 Outflow」时，按下面的步骤执行。

## 部署到 Cloudflare（推荐）

前提：已登录 wrangler（`npx wrangler whoami` 能显示账号），或者已设置 `CLOUDFLARE_API_TOKEN`。

```bash
pnpm install
ALLOWED_EMAIL_DOMAINS="<白名单，如 *.edu.cn>" pnpm setup:cf
```

开发阶段可以先用 `MAIL_DRIVER=console`（验证码会打印在 `npx wrangler tail` 中）。要发送真实邮件时，修改 `server/wrangler.toml` 的 `[vars]`：

```toml
MAIL_DRIVER = "smtp"
MAIL_FROM = "站点名 <noreply@your-domain>"
SMTP_HOST = "smtp.xxx.com"
SMTP_PORT = "465"      # Workers 禁止 25 端口
SMTP_SECURE = "true"
SMTP_USER = "..."
```

然后执行：

```bash
cd server && printf '%s' "<smtp 密码>" | npx wrangler secret put SMTP_PASS && cd .. && pnpm deploy:cf
```

## 自托管（Docker）

```bash
cp .env.example .env
sed -i.bak "s/^SESSION_SECRET=$/SESSION_SECRET=$(openssl rand -hex 32)/" .env
# 按需修改 .env 中的 ALLOWED_EMAIL_DOMAINS、SMTP_*、APP_URL
docker compose up -d --build
```

## 开发约定

- 业务逻辑放在 `server/src/core`，平台差异只放在 `server/src/adapters/{cf,node}.ts`
- 新增数据表时，在 `server/migrations/` 新建 `000N_xxx.sql`。D1 和 Node 共用这些迁移文件，不要修改已发布的迁移
- 所有读取文档的入口都必须经过 `core/access.ts` 的 `loadChain` 与 `chainReadable`，以保证子文档不会比父文档更开放
- 学校相关的功能做成插件（`plugins/<name>`，约定见 `plugins/README.md`），不要写进核心。插件只能通过 `@outflow/sdk/server`（仅类型）和 `@outflow/sdk/web` 使用宿主能力；新增宿主能力时同时更新 `server/src/plugins/sdk.ts` 或 `web/src/sdk.ts`
- 冒烟测试不依赖任何插件，装不装插件都必须通过
- 检查：`pnpm typecheck`，`pnpm build`
- 冒烟测试（需要全新的数据目录）：
  ```bash
  DATA_DIR=/tmp/of CAPTCHA_PROVIDER=none MAIL_DRIVER=console GEO_COUNTRY_HEADER=X-Test-Country GEO_REGISTER_COUNTRIES= GEO_UNKNOWN=deny RATE_LIMIT_AUTH=1000 PORT=8790 pnpm start > /tmp/of.log 2>&1 &
  BASE=http://localhost:8790 LOG=/tmp/of.log node scripts/smoke.mjs
  ```
