import { Hono } from 'hono'
import { getEmailRules } from '../core/auth'
import { parseCountries, type GeoScope } from '../config'
import { GEO_SCOPES, getGeoRules, isAllowed, setGeoRule } from '../core/geo'
import { normalizeRule } from '../lib/email-rules'
import type { AppEnv } from '../types'
import { body, country, fail, requireAdmin } from './util'

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
  if (b.role === 'admin' || b.role === 'member') await db.run('UPDATE users SET role = ? WHERE id = ?', b.role, id)
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

export default admin
