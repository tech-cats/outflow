#!/usr/bin/env node
/**
 * Cloudflare 一键部署：
 *   1. 检查 wrangler 登录状态
 *   2. 创建（或复用）D1 数据库与 R2 存储桶，并把 database_id 写回 server/wrangler.toml
 *      （该文件不存在时从 wrangler.example.toml 生成；数据库名与存储桶名取自配置）
 *   3. 执行数据库迁移、构建前端、部署 Worker
 *   4. 设置机密：SESSION_SECRET（自动生成），以及环境中存在的 SMTP_PASS / CAPTCHA_SECRET / RESEND_API_KEY
 *
 * 用法：pnpm setup:cf
 * 可选环境变量：ALLOWED_EMAIL_DOMAINS="*.edu.cn,@pku.edu.cn"（写入 wrangler.toml 的 [vars]）
 */
import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(root, 'server')
const tomlPath = join(serverDir, 'wrangler.toml')
if (!existsSync(tomlPath)) {
  copyFileSync(join(serverDir, 'wrangler.example.toml'), tomlPath)
  console.log('已从 wrangler.example.toml 生成 server/wrangler.toml')
}
const tomlValue = (key) => {
  const m = new RegExp(`^${key} = "([^"]+)"`, 'm').exec(readFileSync(tomlPath, 'utf8'))
  if (!m) throw new Error(`server/wrangler.toml 中缺少 ${key}`)
  return m[1]
}
const DB_NAME = tomlValue('database_name')
const BUCKET = tomlValue('bucket_name')

const wrangler = (args, opts = {}) =>
  execSync(`npx wrangler ${args}`, { cwd: serverDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
const step = (msg) => console.log(`\n▶ ${msg}`)

step('检查 Cloudflare 登录状态')
try {
  const who = wrangler('whoami')
  if (/not authenticated|You are not logged in/i.test(who)) throw new Error()
  console.log(who.split('\n').find((l) => /logged in|email/i.test(l))?.trim() ?? '已登录')
} catch {
  console.error('未登录 Cloudflare，请先执行：npx wrangler login（或设置 CLOUDFLARE_API_TOKEN）')
  process.exit(1)
}

step(`创建 / 复用 D1 数据库 "${DB_NAME}"`)
const findDb = () => JSON.parse(wrangler('d1 list --json')).find((d) => d.name === DB_NAME)
let db = findDb()
if (!db) {
  wrangler(`d1 create ${DB_NAME}`)
  db = findDb()
}
if (!db?.uuid) {
  console.error('无法获取 D1 database_id')
  process.exit(1)
}
console.log(`database_id = ${db.uuid}`)

let toml = readFileSync(tomlPath, 'utf8')
toml = toml.replace(/database_id = "[^"]*"/, `database_id = "${db.uuid}"`)
if (process.env.ALLOWED_EMAIL_DOMAINS) {
  toml = toml.replace(/ALLOWED_EMAIL_DOMAINS = "[^"]*"/, `ALLOWED_EMAIL_DOMAINS = "${process.env.ALLOWED_EMAIL_DOMAINS}"`)
}
writeFileSync(tomlPath, toml)

step(`创建 / 复用 R2 存储桶 "${BUCKET}"`)
try {
  wrangler(`r2 bucket create ${BUCKET}`)
  console.log('已创建')
} catch (e) {
  if (!/already exists|already own/i.test(String(e.stderr ?? e.message))) throw e
  console.log('已存在，复用')
}

step('执行数据库迁移')
execSync('npx wrangler d1 migrations apply DB --remote', { cwd: serverDir, stdio: 'inherit', env: { ...process.env, CI: '1' } })

step('构建前端')
execSync('pnpm build', { cwd: root, stdio: 'inherit' })

step('部署 Worker')
execSync('npx wrangler deploy', { cwd: serverDir, stdio: 'inherit' })

step('设置机密')
const putSecret = (name, value) => {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { cwd: serverDir, input: value, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  console.log(`✔ ${name}`)
}
const existing = (() => {
  try {
    return JSON.parse(wrangler('secret list --format json')).map((s) => s.name)
  } catch {
    return []
  }
})()
if (!existing.includes('SESSION_SECRET')) putSecret('SESSION_SECRET', randomBytes(32).toString('hex'))
else console.log('SESSION_SECRET 已存在，保持不变')
for (const k of ['SMTP_PASS', 'CAPTCHA_SECRET', 'RESEND_API_KEY']) {
  if (process.env[k]) putSecret(k, process.env[k])
}

console.log(`
✅ 部署完成。

后续步骤：
  1. 打开 Worker 地址，第一个注册的用户自动成为管理员
  2. 在 server/wrangler.toml 的 [vars] 中配置邮件（MAIL_DRIVER=smtp、SMTP_HOST 等），然后 pnpm deploy:cf
     注意：Workers 禁止 25 端口，请使用 465 或 587
  3. 修改配置后重新部署：pnpm deploy:cf
`)
