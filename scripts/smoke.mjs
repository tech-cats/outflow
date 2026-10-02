#!/usr/bin/env node
/**
 * API 冒烟测试（无依赖）。必须在全新的数据库上运行，服务需要以下环境：
 *   CAPTCHA_PROVIDER=none、MAIL_DRIVER=console（日志写入文件以便读取验证码）、
 *   GEO_COUNTRY_HEADER=X-Test-Country（用请求头模拟访问地区）、GEO_REGISTER_COUNTRIES=（默认不限制）、
 *   GEO_UNKNOWN=deny、RATE_LIMIT_AUTH=1000（测试会在一分钟内发出大量认证请求）
 *
 *   DATA_DIR=/tmp/of CAPTCHA_PROVIDER=none MAIL_DRIVER=console GEO_COUNTRY_HEADER=X-Test-Country \
 *     GEO_REGISTER_COUNTRIES= GEO_UNKNOWN=deny RATE_LIMIT_AUTH=1000 PORT=8790 pnpm start > /tmp/of.log 2>&1 &
 *   BASE=http://localhost:8790 LOG=/tmp/of.log node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8787'
const LOG = process.env.LOG
if (!LOG) throw new Error('请设置 LOG=服务日志文件路径')

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed++
}

async function call(path, { method, body, cookie, headers = {} } = {}) {
  const h = { ...headers }
  if (cookie) h.cookie = cookie
  if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: h,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] }
}

const lastCode = (email) => {
  const m = [...readFileSync(LOG, 'utf8').matchAll(/to=(\S+)\n.*?验证码：(\d{6})/g)].filter((x) => x[1] === email)
  return m.at(-1)?.[2]
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 注册：白名单 / 验证码 / 冷却 ----
let r = await call('/api/auth/send-code', { body: { email: 'a@gmail.com', purpose: 'register' } })
check('白名单外邮箱被拒绝', r.status === 403, r.json?.error)
r = await call('/api/auth/send-code', { body: { email: 'Alice@pku.edu.cn', purpose: 'register' } })
check('白名单内邮箱可发送验证码', r.status === 200)
r = await call('/api/auth/send-code', { body: { email: 'alice@pku.edu.cn', purpose: 'register' } })
check('重发冷却', r.status === 429, r.json?.error)
await sleep(300)
const code = lastCode('alice@pku.edu.cn')
check('验证码已投递（console mailer）', !!code)
r = await call('/api/auth/register', { body: { email: 'alice@pku.edu.cn', code: '000000', name: 'Alice', password: 'password123' } })
check('错误验证码被拒绝', r.status === 400)
r = await call('/api/auth/register', { body: { email: 'alice@pku.edu.cn', code, name: 'Alice', password: 'password123' } })
check('注册成功且首个用户为管理员', r.status === 200 && r.json?.user?.role === 'admin')
const alice = r.cookie

// ---- 地域白名单 ----
const geoPut = (scope, countries, headers = {}) =>
  call(`/api/admin/geo/${scope}`, { method: 'PUT', cookie: alice, body: { countries }, headers })
r = await geoPut('register', 'CN, hk')
check('管理员设置注册地域白名单', r.status === 200)
const sendFrom = (cc) =>
  call('/api/auth/send-code', { body: { email: 'bob@pku.edu.cn', purpose: 'register' }, headers: cc ? { 'X-Test-Country': cc } : {} })
r = await sendFrom('US')
check('US 请求注册被拒绝', r.status === 403 && r.json?.geo === true, r.json?.error)
r = await sendFrom(null)
check('无法识别地区时默认拒绝', r.status === 403 && r.json?.geo === true)
r = await sendFrom('HK')
check('HK 请求通过地域检查', r.status === 200, r.json?.error)
r = await call('/api/config', { headers: { 'X-Test-Country': 'US' } })
check('/api/config 提前告知被拒范围', JSON.stringify(r.json?.geo?.blocked) === '["register"]' && r.json?.geo?.country === 'US')
r = await call('/api/auth/login', { body: { email: 'alice@pku.edu.cn', password: 'password123' }, headers: { 'X-Test-Country': 'US' } })
check('登录范围未限制时不受影响', r.status === 200)
r = await geoPut('login', 'CN')
check('限制登录时阻止管理员把自己锁在外面', r.status === 400, r.json?.error)
r = await geoPut('login', 'XYZ', { 'X-Test-Country': 'CN' })
check('非法地区代码被拒绝', r.status === 400)
r = await geoPut('register', null)
r = await sendFrom(null)
check('恢复默认后（不限制）可正常请求', r.status === 429 || r.status === 200, String(r.status))

// ---- 可见性继承 ----
const col = (await call('/api/collections', { cookie: alice, body: { name: '冒烟测试' } })).json.id
const mk = async (title, parentId) => (await call('/api/docs', { cookie: alice, body: { collectionId: col, title, parentId } })).json.id
const pub = await mk('公开文档')
const prot = await mk('受保护父')
await call(`/api/docs/${prot}`, { method: 'PATCH', cookie: alice, body: { visibility: 'protected' } })
const child = await mk('子文档', prot)
await call(`/api/docs/${child}`, { method: 'PATCH', cookie: alice, body: { visibility: 'public' } })
const draft = await mk('草稿')
await call(`/api/docs/${draft}`, { method: 'PATCH', cookie: alice, body: { visibility: 'draft' } })

r = await call(`/api/collections/${col}/tree`)
check('匿名文档树只含公开文档', JSON.stringify(r.json.docs.map((d) => d.title)) === '["公开文档"]')
r = await call(`/api/collections/${col}/tree`, { cookie: alice })
check('作者可见全部文档', r.json.docs.length === 4)
check('匿名访问公开文档 200', (await call(`/d/${pub}`)).status === 200)
check('受保护父下的“公开”子文档对匿名 401', (await call(`/d/${child}`)).status === 401)
check('匿名访问草稿 404', (await call(`/d/${draft}`)).status === 404)
check('登录后可读子文档', (await call(`/d/${child}`, { cookie: alice })).status === 200)
const sitemap = (await call('/sitemap.xml')).text
check('sitemap 只含公开文档', sitemap.includes(pub) && !sitemap.includes(child) && !sitemap.includes(draft))

// ---- CSRF / 上传权限 ----
const fd = new FormData()
fd.append('name', 'x')
r = await call('/api/collections', { cookie: alice, body: fd, headers: { origin: 'http://evil.example' } })
check('跨站表单请求被拒绝', r.status === 403)
const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
const up = new FormData()
up.append('file', new Blob([png], { type: 'image/png' }), 'a.png')
up.append('docId', prot)
r = await call('/api/uploads', { cookie: alice, body: up, headers: { origin: BASE } })
check('上传图片', r.status === 200, r.json?.url)
const img = r.json?.url
check('匿名无法读取受保护文档的图片', (await call(img)).status === 404)
check('登录用户可读取图片', (await call(img, { cookie: alice })).status === 200)

// ---- 登录：渐进式验证码 ----
let flags = []
for (let i = 0; i < 4; i++) {
  r = await call('/api/auth/login', { body: { email: 'alice@pku.edu.cn', password: 'bad' } })
  flags.push(r.json?.captcha)
}
const { loginCaptcha } = (await call('/api/config')).json
const expected = loginCaptcha === 'always' ? '[true,true,true,true]' : '[false,false,true,true]'
check(loginCaptcha === 'always' ? '每次登录都要求验证码' : '连续失败 3 次后要求验证码', JSON.stringify(flags) === expected, JSON.stringify(flags))
r = await call('/api/auth/login', { body: { email: 'alice@pku.edu.cn', password: 'password123' } })
check('正确密码可登录', r.status === 200)

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
