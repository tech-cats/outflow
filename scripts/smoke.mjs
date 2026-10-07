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
  // 模拟浏览器：非 GET 请求带上同源 Origin（可被 headers 覆盖）
  const m = method ?? (body !== undefined ? 'POST' : 'GET')
  const h = m !== 'GET' ? { origin: BASE, ...headers } : { ...headers }
  if (cookie) h.cookie = cookie
  if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method: m,
    headers: h,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0], location: res.headers.get('location') }
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

// ---- 不暴露邮箱是否注册：未注册的邮箱找回密码，照常发信（提醒邮件）并照常冷却 ----
r = await call('/api/auth/send-code', { body: { email: 'nobody@pku.edu.cn', purpose: 'reset' } })
check('未注册邮箱找回密码返回成功', r.status === 200)
r = await call('/api/auth/send-code', { body: { email: 'nobody@pku.edu.cn', purpose: 'reset' } })
check('未注册邮箱同样受重发冷却', r.status === 429, r.json?.error)
await sleep(300)
check(
  '未注册邮箱收到提醒邮件而不是验证码',
  /to=nobody@pku\.edu\.cn\n.*找回密码提醒/.test(readFileSync(LOG, 'utf8')) && !lastCode('nobody@pku.edu.cn'),
)

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
const col = (await call('/api/topics', { cookie: alice, body: { name: '冒烟测试' } })).json.id
const mk = async (title, parentId) => (await call('/api/docs', { cookie: alice, body: { topicId: col, title, parentId } })).json.id
const topicDocs = async (cookie, topicId = col) => (await call('/api/tree', { cookie })).json.docs.filter((d) => d.topicId === topicId)
const pub = await mk('公开文档')
const prot = await mk('受保护父')
await call(`/api/docs/${prot}`, { method: 'PATCH', cookie: alice, body: { visibility: 'protected' } })
const child = await mk('子文档', prot)
await call(`/api/docs/${child}`, { method: 'PATCH', cookie: alice, body: { visibility: 'public' } })
const draft = await mk('草稿')
await call(`/api/docs/${draft}`, { method: 'PATCH', cookie: alice, body: { visibility: 'draft' } })

check('匿名文档树只含公开文档', JSON.stringify((await topicDocs()).map((d) => d.title)) === '["公开文档"]')
check('作者可见全部文档', (await topicDocs(alice)).length === 4)
check('匿名访问公开文档 200', (await call(`/d/${pub}`)).status === 200)
check('受保护父下的“公开”子文档对匿名 401', (await call(`/d/${child}`)).status === 401)
check('匿名访问草稿 404', (await call(`/d/${draft}`)).status === 404)
check('登录后可读子文档', (await call(`/d/${child}`, { cookie: alice })).status === 200)
const sitemap = (await call('/sitemap.xml')).text
check('sitemap 只含公开文档', sitemap.includes(pub) && !sitemap.includes(child) && !sitemap.includes(draft))

// ---- CSRF / 上传权限 ----
const fd = new FormData()
fd.append('name', 'x')
r = await call('/api/topics', { cookie: alice, body: fd, headers: { origin: 'http://evil.example' } })
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
// 站点图标测试用的公开图片
const iconUp = new FormData()
iconUp.append('file', new Blob([png], { type: 'image/png' }), 'icon.png')
const icon = (await call('/api/uploads', { cookie: alice, body: iconUp })).json?.url
check('匿名无法读取受保护文档的图片', (await call(img)).status === 404)
check('登录用户可读取图片', (await call(img, { cookie: alice })).status === 200)

// ---- 角色权限 ----
const signup = async (name) => {
  const email = `${name}@pku.edu.cn`
  if (!lastCode(email)) {
    await call('/api/auth/send-code', { body: { email, purpose: 'register' } })
    await sleep(300)
  }
  const r = await call('/api/auth/register', { body: { email, code: lastCode(email), name, password: 'password123' } })
  return { id: r.json?.user?.id, role: r.json?.user?.role, cookie: r.cookie }
}
const setRole = (u, role) => call(`/api/admin/users/${u.id}`, { method: 'PATCH', cookie: alice, body: { role } })
const bob = await signup('bob')
const carol = await signup('carol')
const dave = await signup('dave')
check('新用户默认为成员', bob.role === 'member' && carol.role === 'member')
await setRole(carol, 'contributor')
await setRole(dave, 'editor')
r = await setRole(bob, 'superuser')
check('非法角色被忽略', r.status === 200 && (await call('/api/admin/users', { cookie: alice })).json.users.find((u) => u.id === bob.id).role === 'member')

const as = (u, path, opts = {}) => call(path, { ...opts, cookie: u.cookie })
r = await as(bob, '/api/docs', { body: { topicId: col, title: 'x' } })
check('成员不能新建文档', r.status === 403)
r = await as(bob, `/api/docs/${pub}`)
check('成员只读', r.status === 200 && r.json.canEdit === false)
check('成员不能修改文档', (await as(bob, `/api/docs/${pub}`, { method: 'PATCH', body: { title: 'x' } })).status === 403)
check('成员看不到写文档入口', !(await as(bob, '/')).text.includes('href="/new"'))

check('贡献者不能新建主题', (await as(carol, '/api/topics', { body: { name: 'x' } })).status === 403)
r = await as(carol, '/api/docs', { body: { topicId: col, title: '贡献者文档' } })
check('贡献者可新建文档', r.status === 200)
const cdoc = r.json?.id
check('贡献者可修改自己的文档', (await as(carol, `/api/docs/${cdoc}`, { method: 'PATCH', body: { title: '改名' } })).status === 200)
check('贡献者可发布自己的文档', (await as(carol, `/api/docs/${cdoc}`, { method: 'PATCH', body: { visibility: 'protected' } })).status === 200)
check('贡献者不能修改他人文档', (await as(carol, `/api/docs/${pub}`, { method: 'PATCH', body: { title: 'x' } })).status === 403)
r = await as(carol, '/api/docs', { body: { title: '子', parentId: pub } })
check('贡献者可在他人文档下新建子文档', r.status === 200)
check('贡献者可删除自己的文档', (await as(carol, `/api/docs/${r.json?.id}`, { method: 'DELETE' })).status === 200)
check('贡献者不能删除他人文档', (await as(carol, `/api/docs/${child}`, { method: 'DELETE' })).status === 403)

check('编辑可修改他人文档', (await as(dave, `/api/docs/${cdoc}`, { method: 'PATCH', body: { title: '审稿' } })).status === 200)
check('编辑不能把他人文档设为草稿', (await as(dave, `/api/docs/${cdoc}`, { method: 'PATCH', body: { visibility: 'draft' } })).status === 403)
check('编辑看不到他人草稿', (await as(dave, `/api/docs/${draft}`)).status === 404)
check('编辑不能连同子文档删除', (await as(dave, `/api/docs/${prot}`, { method: 'DELETE' })).status === 400)
check('编辑可删除他人文档', (await as(dave, `/api/docs/${cdoc}`, { method: 'DELETE' })).status === 200)
check('编辑可新建主题', (await as(dave, '/api/topics', { body: { name: '编辑主题' } })).status === 200)
check('编辑不能锁定文档', (await as(dave, `/api/docs/${pub}`, { method: 'PATCH', body: { locked: true } })).status === 403)

await call(`/api/docs/${pub}`, { method: 'PATCH', cookie: alice, body: { locked: true } })
check('锁定后编辑不能修改', (await as(dave, `/api/docs/${pub}`, { method: 'PATCH', body: { title: 'x' } })).status === 403)
check('锁定后不能新建子文档', (await as(dave, '/api/docs', { body: { parentId: pub } })).status === 403)
check('锁定后管理员仍可修改', (await call(`/api/docs/${pub}`, { method: 'PATCH', cookie: alice, body: { title: '公开文档' } })).status === 200)

// ---- 评论 ----
const cm = (u, docId, body) => as(u, `/api/docs/${docId}/comments`, { body })
check('匿名不能读取评论', (await call(`/api/docs/${pub}/comments`)).status === 401)
check('不可读文档的评论不可见', (await as(bob, `/api/docs/${draft}/comments`)).status === 404)
r = await cm(bob, pub, { body: '成员的讨论' })
check('成员可以发表讨论', r.status === 200)
const disc = r.json?.id
check('空评论被拒绝', (await cm(bob, pub, { body: '  ' })).status === 400)
r = await cm(carol, pub, { body: '回复', parentId: disc })
check('可以回复', r.status === 200)
const reply = r.json?.id
const anchor = JSON.stringify({ from: 'AQIDBA==', to: 'BQYHCA==' })
r = await cm(bob, pub, { body: '这里有错字', anchor, quote: '公开' })
check('成员可以添加行内批注', r.status === 200)
const note = r.json?.id
check('非法锚点被拒绝', (await cm(bob, pub, { body: 'x', anchor: '{"from":"<>"}' })).status === 400)
r = await as(bob, `/api/docs/${pub}/comments`)
check('评论列表包含讨论、回复与批注', r.json?.comments?.length === 3 && r.json.comments.find((x) => x.id === reply)?.parentId === disc)
check('贡献者不能解决他人在他人文档上的批注', (await as(carol, `/api/comments/${note}`, { method: 'PATCH', body: { resolved: true } })).status === 403)
check('发起人可以解决批注', (await as(bob, `/api/comments/${note}`, { method: 'PATCH', body: { resolved: true } })).status === 200)
check('不能单独解决回复', (await as(carol, `/api/comments/${reply}`, { method: 'PATCH', body: { resolved: true } })).status === 400)
check('不能删除他人评论', (await as(carol, `/api/comments/${disc}`, { method: 'DELETE' })).status === 403)
r = await as(bob, `/d/${pub}`)
check('阅读页对登录用户展示讨论', r.text.includes('成员的讨论') && r.text.includes('id="discussion"'))
check('阅读页对匿名用户不展示讨论', !(await call(`/d/${pub}`)).text.includes('成员的讨论'))
check('编辑可以删除他人讨论（连同回复）', (await as(dave, `/api/comments/${disc}`, { method: 'DELETE' })).status === 200 &&
  (await as(bob, `/api/docs/${pub}/comments`)).json.comments.length === 1)
check('页脚包含 Powered by Outflow', (await call('/')).text.includes('github.com/tech-cats/outflow'))

// ---- 通知 ----
const inbox = async (u) => (await as(u, '/api/notifications')).json
const unread = async (u) => (await as(u, '/api/notifications/unread')).json.count
check('匿名不能读取通知', (await call('/api/notifications')).status === 401)
let n = await inbox({ cookie: alice })
check('文档作者收到新批注通知', n.items.some((x) => x.type === 'comment' && x.link.includes(`note=${note}`)))
r = await as(bob, `/api/docs/${pub}/mentionable?q=car`)
check('提及候选只含能读文档的用户', r.json?.users?.some((u) => u.id === carol.id) && !r.json.users.some((u) => u.id === bob.id))
check('读不到文档时不能查询提及候选', (await as(bob, `/api/docs/${draft}/mentionable`)).status === 404)

const aliceBefore = (await inbox({ cookie: alice })).items.length
r = await cm(carol, pub, { body: `<@${dave.id}> 帮忙看看 https://example.com/a` })
const ask = r.json?.id
await sleep(200)
n = await inbox(dave)
check('被提及者收到 mention 通知', n.items[0]?.type === 'mention' && n.items[0].excerpt.includes('@dave') && n.items[0].link === `/d/${pub}#c-${ask}`)
check('文档作者同时收到 comment 通知', (await inbox({ cookie: alice })).items.length === aliceBefore + 1)
await cm(carol, pub, { body: `<@${dave.id}> 再看一下` })
await sleep(200)
check('每次提及都产生站内通知', (await unread(dave)) === 2)

await cm(dave, pub, { body: `收到 <@${carol.id}>`, parentId: ask })
n = await inbox(carol)
check('同一事件对同一人只发一条（提及优先于回复）', n.items.filter((x) => x.type === 'mention' || x.type === 'reply').length === 1 && n.items[0].type === 'mention')
await cm(bob, pub, { body: '我也觉得', parentId: ask })
n = await inbox(carol)
check('讨论参与者收到回复通知', n.items[0]?.type === 'reply')
check('操作者自己不收到通知', !(await inbox(bob)).items.some((x) => x.excerpt === '我也觉得'))
r = await as(bob, `/d/${pub}`)
check('阅读页渲染提及与链接', r.text.includes('<span class="mention">@dave</span>') && r.text.includes('href="https://example.com/a"'))

const carolCount = await unread(carol)
await cm({ cookie: alice }, draft, { body: `<@${carol.id}> 草稿` })
check('读不到文档的人不会收到通知', (await unread(carol)) === carolCount)

r = await cm(dave, pub, { body: '待解决', anchor, quote: '公开' })
await as({ cookie: alice }, `/api/comments/${r.json.id}`, { method: 'PATCH', body: { resolved: true } })
check('批注被他人解决时通知发起人', (await inbox(dave)).items[0]?.type === 'resolve')

await as(carol, '/api/notifications/read', { body: {} })
check('全部标为已读', (await unread(carol)) === 0)
await as(dave, '/api/notifications/read', { body: { ids: [(await inbox(dave)).items[0].id] } })
check('按 id 标为已读', (await inbox(dave)).items.filter((x) => !x.read).length === (await unread(dave)) && (await inbox(dave)).items[0].read)
check('通知不发送邮件', !/subject: [^\n]*(提到了你|回复了讨论|评论了你的文档|解决了你的批注)/.test(readFileSync(LOG, 'utf8')))
const daveCount = (await inbox(dave)).items.length
await as(carol, `/api/comments/${ask}`, { method: 'DELETE' })
check('删除评论后相关通知一并删除', (await inbox(dave)).items.length < daveCount)

// ---- 主题 ----
const topic2 = (await call('/api/topics', { cookie: alice, body: { name: '第二主题' } })).json.id
check('不指定主题时新建到排在最前的主题', (await call('/api/docs', { cookie: alice, body: { title: '默认位置' } })).status === 200 && (await topicDocs(alice)).some((d) => d.title === '默认位置'))
r = await call(`/api/docs/${prot}`, { method: 'PATCH', cookie: alice, body: { topicId: topic2 } })
check('文档可以换主题，子文档跟随', r.status === 200 && (await topicDocs(alice, topic2)).map((d) => d.id).sort().join() === [prot, child].sort().join())
check('换主题后出现在新主题页', (await call(`/c/${topic2}`, { cookie: alice })).text.includes('受保护父'))
const moved = await mk('临时文档')
r = await call(`/api/docs/${moved}`, { method: 'PATCH', cookie: alice, body: { parentId: prot } })
check('移到其他主题的文档下时跟随父文档的主题', r.status === 200 && (await topicDocs(alice, topic2)).some((d) => d.id === moved && d.parentId === prot))
await call(`/api/docs/${moved}`, { method: 'DELETE', cookie: alice })
check('有文档的主题不能删除', (await call(`/api/topics/${topic2}`, { method: 'DELETE', cookie: alice })).status === 400)
check('编辑不能删除主题', (await as(dave, `/api/topics/${topic2}`, { method: 'DELETE' })).status === 403)
check('编辑可以重命名主题', (await as(dave, `/api/topics/${topic2}`, { method: 'PATCH', body: { name: '改名主题' } })).status === 200)
await call(`/api/docs/${prot}`, { method: 'PATCH', cookie: alice, body: { topicId: col } })
check('主题清空后可以删除', (await call(`/api/topics/${topic2}`, { method: 'DELETE', cookie: alice })).status === 200)
check('删除后主题列表不再包含它', !(await call('/api/topics')).json.topics.some((t) => t.id === topic2))

// ---- 头像 ----
check('默认没有头像', (await call('/api/me', { cookie: carol.cookie })).json.user.avatar === null)
const av = new FormData()
av.append('file', new Blob([png], { type: 'image/png' }), 'me.png')
r = await call('/api/me/avatar', { method: 'PUT', cookie: carol.cookie, body: av })
const avatar = r.json?.avatar
check('上传头像', r.status === 200 && /^\/uploads\/[a-z0-9]+$/.test(avatar ?? ''), avatar)
check('头像对匿名可见', (await call(avatar)).status === 200)
check('会话里带头像', (await call('/api/me', { cookie: carol.cookie })).json.user.avatar === avatar)
await as(carol, `/api/docs/${pub}/comments`, { body: { body: '头像测试' } })
check('评论带作者头像', (await as(carol, `/api/docs/${pub}/comments`)).json?.comments?.some((x) => x.authorAvatar === avatar))
check('阅读页显示头像', (await call(`/d/${pub}`, { cookie: carol.cookie })).text.includes(`src="${avatar}"`))
const av2 = new FormData()
av2.append('file', new Blob([png], { type: 'image/png' }), 'me2.png')
r = await call('/api/me/avatar', { method: 'PUT', cookie: carol.cookie, body: av2 })
check('更换头像后旧图片被删除', r.status === 200 && (await call(avatar)).status === 404)
check('恢复默认头像', (await call('/api/me/avatar', { method: 'DELETE', cookie: carol.cookie })).status === 200 && (await call('/api/me', { cookie: carol.cookie })).json.user.avatar === null)
check('非图片不能作为头像', (await call('/api/me/avatar', { method: 'PUT', cookie: carol.cookie, body: (() => { const f = new FormData(); f.append('file', new Blob(['x'], { type: 'text/plain' }), 'a.txt'); return f })() })).status === 400)

// ---- 首页文档 ----
const isHome = (html) => html.includes('data-page="home"')
check('没有首页文档时显示主题列表', !isHome((await call('/')).text) && (await call('/c')).text.includes('冒烟测试'))
check('非管理员不能创建首页文档', (await as(bob, '/api/admin/site/home', { method: 'POST' })).status === 403)
check('管理员创建首页文档', (await call('/api/admin/site/home', { method: 'POST', cookie: alice })).status === 200)
check('创建后匿名首页立即显示首页文档（缓存已清除）', isHome((await call('/')).text))
r = await call('/d/index')
check('/d/index 跳转到首页', r.status === 302 && r.location === '/')
r = await call('/api/tree', { cookie: alice })
check('首页文档不出现在文档树和主题列表中', !r.json.docs.some((d) => d.id === 'index') && !(await call('/c', { cookie: alice })).text.includes('/d/index'))
check('首页文档不能有子文档', (await call('/api/docs', { cookie: alice, body: { title: 'x', parentId: 'index' } })).status === 403)
check('首页文档不能移动', (await call('/api/docs/index', { method: 'PATCH', cookie: alice, body: { parentId: pub } })).status === 400)
await call('/api/docs/index', { method: 'PATCH', cookie: alice, body: { visibility: 'protected' } })
check('首页文档无权阅读时回退到主题列表', !isHome((await call('/')).text) && isHome((await call('/', { cookie: alice })).text))
await call('/api/docs/index', { method: 'DELETE', cookie: alice })
check('删除首页文档后恢复主题列表', !isHome((await call('/', { cookie: alice })).text))

// ---- 验证码邮件模板 ----
const tpl = (body) => call('/api/admin/mail-template', { method: 'PUT', cookie: alice, body })
check('非管理员不能修改邮件模板', (await as(bob, '/api/admin/mail-template', { method: 'PUT', body: { subject: 'x', body: '{code}' } })).status === 403)
check('邮件正文必须包含 {code}', (await tpl({ subject: '{app}', body: '没有验证码' })).status === 400)
r = await call('/api/admin/mail-template/preview', { cookie: alice, body: { subject: 'S {code}', body: '<b>{action}</b>\n{code}' } })
check('邮件预览转义正文中的 HTML', r.json?.subject === 'S 123456' && r.json.html.includes('&lt;b&gt;注册&lt;/b&gt;') && r.json.html.includes('123456'))
check('保存自定义邮件模板', (await tpl({ subject: '自定义标题 {app} {code}', body: '欢迎，验证码 {code}，站点 {url}' })).status === 200)
await call('/api/auth/send-code', { body: { email: 'erin@pku.edu.cn', purpose: 'register' } })
check('验证码邮件使用自定义模板', /to=erin@pku\.edu\.cn\n\s*subject: 自定义标题 \S+ \d{6}\n\s*欢迎，验证码 \d{6}，站点 http/.test(readFileSync(LOG, 'utf8')))
check('恢复默认邮件模板', (await tpl({ reset: true })).status === 200 && (await call('/api/admin/mail-template', { cookie: alice })).json?.custom === false)

// ---- 站点信息 ----
const siteInfo = (u, b) => call('/api/admin/site/info', { method: 'PUT', cookie: u, body: b })
check('非管理员不能修改站点信息', (await siteInfo(bob.cookie, { name: 'x', description: '', icon: null })).status === 403)
check('站点图标只接受本站上传的图片', (await siteInfo(alice, { name: '', description: '', icon: 'https://evil.example/a.png' })).status === 400)
const defaultName = (await call('/api/config')).json.appName
check('修改站点信息', (await siteInfo(alice, { name: ' 测试站点 ', description: '一句话介绍', icon })).status === 200)
r = await call('/')
check(
  '首页使用新的站点名、描述和图标',
  r.text.includes('<title>测试站点</title>') && r.text.includes('content="一句话介绍"') && r.text.includes(`<link rel="icon" href="${icon}"`),
)
r = (await call('/api/config')).json
check('/api/config 返回站点信息', r.appName === '测试站点' && r.appIcon === icon && r.appDescription === '一句话介绍')
check('匿名可读取站点图标', (await call(icon)).status === 200)
await call('/api/auth/send-code', { body: { email: 'frank@pku.edu.cn', purpose: 'register' } })
check('验证码邮件使用新的站点名', /to=frank@pku\.edu\.cn\n\s*subject: 【测试站点】/.test(readFileSync(LOG, 'utf8')))
await siteInfo(alice, { name: '', description: '', icon: null })
r = await call('/')
check('清空后恢复默认站点名和图标', r.text.includes(`<title>${defaultName}</title>`) && !r.text.includes(`href="${icon}"`))

// ---- 注册页提示 ----
const regTexts = (u, b) => call('/api/admin/register-texts', { method: 'PUT', cookie: u, body: b })
check('非管理员不能修改注册页提示', (await regTexts(bob.cookie, { hint: 'x', denied: 'x' })).status === 403)
r = await call('/api/auth/send-code', { body: { email: 'mallory@gmail.com', purpose: 'register' } })
check('非白名单邮箱默认提示', r.status === 403 && r.json?.notAllowed === true && r.json.error.length > 0)
check('修改注册页提示', (await regTexts(alice, { hint: '请用学校邮箱注册', denied: '只接受 pku.edu.cn 邮箱\n没有的话请联系管理员' })).status === 200)
r = await call('/api/auth/send-code', { body: { email: 'mallory@gmail.com', purpose: 'register' } })
check('非白名单邮箱返回后台配置的提示', r.status === 403 && r.json?.error === '只接受 pku.edu.cn 邮箱\n没有的话请联系管理员')
check('/api/config 返回注册说明', (await call('/api/config')).json?.registerHint === '请用学校邮箱注册')
await regTexts(alice, { hint: '', denied: '' })
check('清空后恢复默认注册页提示', (await call('/api/admin/register-texts', { cookie: alice })).json?.hint === '' && (await call('/api/config')).json?.registerHint !== '请用学校邮箱注册')

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
