import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import {
  CAPTCHA_AFTER_FAILURES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearFailures,
  codeMail,
  checkEmailCode,
  consumeEmailCode,
  createSession,
  deleteSession,
  emailAllowed,
  getFailures,
  issueEmailCode,
  recordFailure,
  type CodePurpose,
} from '../core/auth'
import { createAltchaChallenge, verifyCaptcha } from '../core/captcha'
import { hashPassword, newId, verifyPassword } from '../lib/crypto'
import { normalizeEmail } from '../lib/email-rules'
import type { AppEnv } from '../types'
import { blockedScopes } from '../core/geo'
import { body, country, fail, geoBlock, ip, rateLimit, str } from './util'

const auth = new Hono<AppEnv>()

function passwordError(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '密码至少 8 位'
  if (pw.length > 128) return '密码过长'
  return null
}

function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.var.p.config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

// 出题只是签名，开销很小；隐式验证每次打开页面都会请求，放在宽松的 read 限流里，避免误伤共用出口 IP 的校园网
auth.get('/captcha/challenge', rateLimit('read'), async (c) => {
  if (c.var.p.config.captcha.provider !== 'altcha') return fail(c, 404, 'altcha 未启用')
  c.header('Cache-Control', 'no-store')
  return c.json(await createAltchaChallenge(c.var.p))
})

auth.post('/auth/send-code', rateLimit('auth'), async (c) => {
  const p = c.var.p
  const b = await body(c)
  const email = normalizeEmail(b.email)
  const purpose = b.purpose as CodePurpose
  if (!email) return fail(c, 400, '邮箱格式不正确')
  if (purpose !== 'register' && purpose !== 'reset') return fail(c, 400, '参数错误')
  // 地域检查放在人机验证之前：被拒绝的地区不消耗验证码 token
  const geo = await geoBlock(c, purpose === 'register' ? 'register' : 'login')
  if (geo) return geo
  if (p.config.mail.driver === 'none') return fail(c, 503, '邮件服务未配置，暂时无法发送验证码，请联系管理员')
  if (!(await verifyCaptcha(p, b.captcha, ip(c)))) return fail(c, 400, '人机验证失败，请重试', { captcha: true })

  const exists = await p.db.get('SELECT 1 AS x FROM users WHERE email = ?', email)
  if (purpose === 'register') {
    if (!p.config.registrationEnabled) return fail(c, 403, '当前未开放注册')
    // 白名单检查放在发信之前：不在名单内的邮箱不会消耗任何邮件额度
    if (!(await emailAllowed(p, email))) return fail(c, 403, '该邮箱不在允许注册的范围内')
    if (exists) return fail(c, 409, '该邮箱已注册，请直接登录')
  } else if (!exists) {
    // 重置密码时不暴露邮箱是否存在
    return c.json({ ok: true })
  }

  const r = await issueEmailCode(p, email, purpose)
  if (!r.ok) return fail(c, 429, r.error, { retryAfter: r.retryAfter })
  try {
    await p.mailer.send({ to: email, ...codeMail(p, r.code, purpose) })
  } catch (err) {
    console.error('send mail failed', err)
    await p.db.run('DELETE FROM email_codes WHERE email = ? AND created_at >= ?', email, Date.now() - 60_000)
    return fail(c, 502, '邮件发送失败，请稍后再试')
  }
  return c.json({ ok: true })
})

/** 分步表单第 2 步：只校验验证码，不作废；最终提交时再次校验并作废 */
auth.post('/auth/check-code', rateLimit('auth'), async (c) => {
  const p = c.var.p
  const b = await body(c)
  const email = normalizeEmail(b.email)
  const purpose = b.purpose as CodePurpose
  if (!email) return fail(c, 400, '邮箱格式不正确')
  if (purpose !== 'register' && purpose !== 'reset') return fail(c, 400, '参数错误')
  const geo = await geoBlock(c, purpose === 'register' ? 'register' : 'login')
  if (geo) return geo
  const err = await checkEmailCode(p, email, purpose, String(b.code ?? ''))
  if (err) return fail(c, 400, err)
  return c.json({ ok: true })
})

auth.post('/auth/register', rateLimit('auth'), async (c) => {
  const p = c.var.p
  const geo = await geoBlock(c, 'register')
  if (geo) return geo
  const b = await body(c)
  const email = normalizeEmail(b.email)
  const name = str(b.name, 40)
  if (!email) return fail(c, 400, '邮箱格式不正确')
  if (!name) return fail(c, 400, '请填写昵称（不超过 40 字）')
  const pwErr = passwordError(b.password)
  if (pwErr) return fail(c, 400, pwErr)
  if (!p.config.registrationEnabled) return fail(c, 403, '当前未开放注册')
  if (!(await emailAllowed(p, email))) return fail(c, 403, '该邮箱不在允许注册的范围内')

  const codeErr = await consumeEmailCode(p, email, 'register', String(b.code ?? ''))
  if (codeErr) return fail(c, 400, codeErr)
  if (await p.db.get('SELECT 1 AS x FROM users WHERE email = ?', email)) return fail(c, 409, '该邮箱已注册')

  const id = newId()
  // 第一个注册的用户自动成为管理员
  const first = !(await p.db.get('SELECT 1 AS x FROM users LIMIT 1'))
  await p.db.run(
    'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    email,
    name,
    await hashPassword(b.password as string),
    first ? 'admin' : 'member',
    Date.now(),
  )
  setSessionCookie(c, await createSession(p, id))
  return c.json({ user: { id, email, name, role: first ? 'admin' : 'member' } })
})

auth.post('/auth/login', rateLimit('auth'), async (c) => {
  const p = c.var.p
  const geo = await geoBlock(c, 'login')
  if (geo) return geo
  const b = await body(c)
  const email = normalizeEmail(b.email)
  if (!email || typeof b.password !== 'string') return fail(c, 400, '邮箱或密码错误')

  const keys = [`login:e:${email}`, `login:ip:${ip(c)}`]
  const [byEmail, byIp] = await Promise.all(keys.map((k) => getFailures(p, k)))
  const lockedUntil = byEmail.lockedUntil ?? byIp.lockedUntil
  if (lockedUntil) {
    return fail(c, 429, `失败次数过多，请 ${Math.ceil((lockedUntil - Date.now()) / 60000)} 分钟后再试`)
  }
  const always = p.config.loginCaptcha === 'always'
  const needCaptcha = always || Math.max(byEmail.count, byIp.count) >= CAPTCHA_AFTER_FAILURES
  if (needCaptcha && !(await verifyCaptcha(p, b.captcha, ip(c)))) {
    return fail(c, 400, '请完成人机验证', { captcha: true })
  }

  const user = await p.db.get<{ id: string; name: string; role: string; password_hash: string; disabled: number }>(
    'SELECT id, name, role, password_hash, disabled FROM users WHERE email = ?',
    email,
  )
  // 用户不存在时也做一次哈希，避免通过响应时间探测邮箱是否注册
  const ok = user ? await verifyPassword(b.password, user.password_hash) : (await hashPassword(b.password), false)
  if (!user || !ok) {
    await Promise.all(keys.map((k) => recordFailure(p, k)))
    const count = Math.max(byEmail.count, byIp.count) + 1
    return fail(c, 401, '邮箱或密码错误', { captcha: always || count >= CAPTCHA_AFTER_FAILURES })
  }
  if (user.disabled) return fail(c, 403, '账号已被停用')
  await clearFailures(p, keys[0])
  setSessionCookie(c, await createSession(p, user.id))
  return c.json({ user: { id: user.id, email, name: user.name, role: user.role } })
})

auth.post('/auth/reset', rateLimit('auth'), async (c) => {
  const p = c.var.p
  const geo = await geoBlock(c, 'login')
  if (geo) return geo
  const b = await body(c)
  const email = normalizeEmail(b.email)
  if (!email) return fail(c, 400, '邮箱格式不正确')
  const pwErr = passwordError(b.password)
  if (pwErr) return fail(c, 400, pwErr)
  const codeErr = await consumeEmailCode(p, email, 'reset', String(b.code ?? ''))
  if (codeErr) return fail(c, 400, codeErr)
  const user = await p.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', email)
  if (!user) return fail(c, 400, '验证码无效或已过期')
  await p.db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password as string), user.id)
  // 重置密码后注销所有旧会话
  await p.db.run('DELETE FROM sessions WHERE user_id = ?', user.id)
  await clearFailures(p, `login:e:${email}`)
  setSessionCookie(c, await createSession(p, user.id))
  return c.json({ ok: true })
})

auth.post('/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await deleteSession(c.var.p, token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

auth.get('/me', (c) => c.json({ user: c.var.user }))

auth.get('/config', async (c) => {
  const { appName, registrationEnabled, loginCaptcha, captcha, mail } = c.var.p.config
  const cc = country(c)
  c.header('Cache-Control', 'no-store')
  return c.json({
    // 当前访问者被地域白名单拒绝的范围，前端据此提前提示
    geo: { country: cc, blocked: await blockedScopes(c.var.p, cc) },
    mail: { configured: mail.driver !== 'none', devConsole: mail.driver === 'console' },
    appName,
    registrationEnabled,
    loginCaptcha,
    captcha: { provider: captcha.provider, siteKey: captcha.siteKey },
  })
})

export default auth
