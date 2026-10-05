import { Hono } from 'hono'
import type { Context } from 'hono'
import { ROLES } from '../core/access'
import { getEmailRules } from '../core/auth'
import { parseCountries, type GeoScope } from '../config'
import { GEO_SCOPES, getGeoRules, isAllowed, setGeoRule } from '../core/geo'
import { DEFAULT_MAIL_TEMPLATE, MAIL_LIMITS, MAIL_PLACEHOLDERS, checkMailTemplate, getMailTemplate, renderMail, setMailTemplate, type MailTemplate } from '../core/mail-template'
import { HOME_DOC_ID, SITE_LIMITS, createHomeDoc, getSiteInfo, normalizeSiteInfo, setSiteInfo } from '../core/site'
import { normalizeRule } from '../lib/email-rules'
import type { AppEnv, Role } from '../types'
import { body, country, fail, rateLimit, requireAdmin, siteInfo } from './util'

const admin = new Hono<AppEnv>()
admin.use('*', requireAdmin)

admin.get('/email-rules', async (c) => c.json(await getEmailRules(c.var.p)))

admin.post('/email-rules', async (c) => {
  const pattern = normalizeRule((await body(c)).pattern)
  if (!pattern) return fail(c, 400, '规则格式不正确，示例：*.edu.cn、@pku.edu.cn、someone@gmail.com')
  await c.var.p.db.run('INSERT OR IGNORE INTO email_rules (pattern, created_at) VALUES (?, ?)', pattern, Date.now())
  return c.json({ ok: true })
})

admin.delete('/email-rules', async (c) => {
  await c.var.p.db.run('DELETE FROM email_rules WHERE pattern = ?', c.req.query('pattern') ?? '')
  return c.json({ ok: true })
})

admin.get('/users', async (c) => {
  const users = await c.var.p.db.all(
    'SELECT id, email, name, role, disabled, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 500',
  )
  return c.json({ users })
})

admin.patch('/users/:id', async (c) => {
  const id = c.req.param('id')
  const b = await body(c)
  const db = c.var.p.db
  if (id === c.var.user!.id) return fail(c, 400, '不能修改自己的角色或状态')
  if (ROLES.includes(b.role as Role)) await db.run('UPDATE users SET role = ? WHERE id = ?', b.role, id)
  if (typeof b.disabled === 'boolean') {
    await db.run('UPDATE users SET disabled = ? WHERE id = ?', b.disabled ? 1 : 0, id)
    if (b.disabled) await db.run('DELETE FROM sessions WHERE user_id = ?', id)
  }
  return c.json({ ok: true })
})

admin.get('/geo', async (c) => {
  const p = c.var.p
  return c.json({
    scopes: GEO_SCOPES,
    rules: await getGeoRules(p),
    defaults: p.config.geo.defaults,
    unknown: p.config.geo.unknown,
    yourCountry: country(c),
  })
})

/** body: { countries: "CN,HK" } 设置；{ countries: null } 恢复环境变量默认值；"" 表示不限制 */
admin.put('/geo/:scope', async (c) => {
  const scope = c.req.param('scope') as GeoScope
  if (!(scope in GEO_SCOPES)) return fail(c, 404, '未知范围')
  const b = await body(c)
  if (b.countries === null) {
    await setGeoRule(c.var.p, scope, null)
    return c.json({ ok: true })
  }
  if (typeof b.countries !== 'string') return fail(c, 400, '参数错误')
  const list = parseCountries(b.countries)
  const invalid = b.countries.split(/[,\s]+/).filter((x) => x && !list.includes(x.trim().toUpperCase()))
  if (invalid.length) return fail(c, 400, `无法识别的地区代码：${invalid.join(', ')}（请使用两位代码，如 CN、HK）`)
  // 防止管理员把自己锁在外面：限制登录时，必须包含自己当前的地区
  const cc = country(c)
  if (scope === 'login' && !isAllowed({ countries: list, source: 'admin' }, cc, c.var.p.config.geo.unknown)) {
    return fail(c, 400, `你当前的地区（${cc ?? '未知'}）不在列表中，保存后你将无法登录`)
  }
  await setGeoRule(c.var.p, scope, list)
  return c.json({ ok: true })
})

admin.get('/site', async (c) => {
  const p = c.var.p
  const [home, site] = await Promise.all([
    p.db.get<{ title: string; visibility: string }>('SELECT title, visibility FROM docs WHERE id = ?', HOME_DOC_ID),
    getSiteInfo(p),
  ])
  // name 为空表示使用环境变量 APP_NAME
  return c.json({
    home: home ?? null,
    info: { ...site, name: site.name === p.config.appName ? '' : site.name },
    defaultName: p.config.appName,
    limits: SITE_LIMITS,
  })
})

/** body: { name, description, icon }；name 留空恢复为 APP_NAME，icon 为 null 使用内置图标 */
admin.put('/site/info', async (c) => {
  const info = normalizeSiteInfo(await body(c))
  if (typeof info === 'string') return fail(c, 400, info)
  await setSiteInfo(c.var.p, info)
  return c.json({ ok: true })
})

admin.post('/site/home', async (c) => {
  const r = await createHomeDoc(c.var.p, c.var.user!.id)
  if (r === 'no-collection') return fail(c, 400, '请先创建一个集合')
  return c.json({ ok: true })
})

/* ---------------- 验证码邮件模板 ---------------- */

const templateFrom = (b: Record<string, unknown>): MailTemplate | null =>
  typeof b.subject === 'string' && typeof b.body === 'string' ? { subject: b.subject, body: b.body.replace(/\r\n/g, '\n') } : null

const sampleVars = async (c: Context<AppEnv>) => ({
  app: (await siteInfo(c)).name,
  action: '注册',
  code: '123456',
  url: c.var.p.config.appUrl || new URL(c.req.url).origin,
})

admin.get('/mail-template', async (c) =>
  c.json({ ...(await getMailTemplate(c.var.p)), defaults: DEFAULT_MAIL_TEMPLATE, placeholders: MAIL_PLACEHOLDERS, limits: MAIL_LIMITS }),
)

/** body: { subject, body } 保存；{ reset: true } 恢复默认 */
admin.put('/mail-template', async (c) => {
  const b = await body(c)
  if (b.reset === true) {
    await setMailTemplate(c.var.p, null)
    return c.json({ ok: true })
  }
  const t = templateFrom(b)
  if (!t) return fail(c, 400, '参数错误')
  const err = checkMailTemplate(t)
  if (err) return fail(c, 400, err)
  await setMailTemplate(c.var.p, t)
  return c.json({ ok: true })
})

/** 用示例数据渲染（未保存的）模板 */
admin.post('/mail-template/preview', async (c) => {
  const t = templateFrom(await body(c))
  if (!t) return fail(c, 400, '参数错误')
  return c.json({ ...renderMail(t, await sampleVars(c)), error: checkMailTemplate(t) })
})

/** 把（未保存的）模板发一封测试邮件到自己的邮箱，用于检查发信配置 */
admin.post('/mail-template/test', rateLimit('auth'), async (c) => {
  const t = templateFrom(await body(c))
  if (!t) return fail(c, 400, '参数错误')
  const err = checkMailTemplate(t)
  if (err) return fail(c, 400, err)
  try {
    await c.var.p.mailer.send({ to: c.var.user!.email, ...renderMail(t, await sampleVars(c)) })
  } catch (e) {
    console.error('send test mail failed', e)
    return fail(c, 502, `发送失败：${(e as Error).message}`)
  }
  return c.json({ ok: true, to: c.var.user!.email })
})

export default admin
