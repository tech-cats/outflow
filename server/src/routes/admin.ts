import { Hono } from 'hono'
import { getEmailRules } from '../core/auth'
import { normalizeRule } from '../lib/email-rules'
import type { AppEnv } from '../types'
import { body, fail, requireAdmin } from './util'

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

export default admin
