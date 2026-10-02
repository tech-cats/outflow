import { Hono } from 'hono'
import { chainReadable, loadChain } from '../core/access'
import type { AppEnv } from '../types'
import { body, requireUser } from './util'

const notifications = new Hono<AppEnv>()
// 注意不要用 notifications.use('*')：挂载到 /api 后会作用于所有 /api 路由

notifications.get('/notifications/unread', requireUser, async (c) => {
  const row = await c.var.p.db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    c.var.user!.id,
  )
  c.header('Cache-Control', 'no-store')
  return c.json({ count: row?.n ?? 0 })
})

notifications.get('/notifications', requireUser, async (c) => {
  const p = c.var.p
  const user = c.var.user!
  const rows = await p.db.all<{
    id: string
    type: string
    actor_name: string | null
    doc_id: string
    doc_title: string | null
    excerpt: string
    link: string
    read_at: number | null
    created_at: number
  }>(
    `SELECT n.id, n.type, u.name AS actor_name, n.doc_id, d.title AS doc_title, n.excerpt, n.link, n.read_at, n.created_at
     FROM notifications n LEFT JOIN users u ON u.id = n.actor_id LEFT JOIN docs d ON d.id = n.doc_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`,
    user.id,
  )
  // 文档权限可能在通知产生后收紧，展示前再检查一次
  const readable = new Map<string, boolean>()
  for (const id of new Set(rows.map((r) => r.doc_id))) readable.set(id, chainReadable(user, await loadChain(p.db, id)))
  c.header('Cache-Control', 'no-store')
  return c.json({
    items: rows
      .filter((r) => readable.get(r.doc_id))
      .map((r) => ({
        id: r.id,
        type: r.type,
        actorName: r.actor_name,
        docTitle: r.doc_title,
        excerpt: r.excerpt,
        link: r.link,
        read: !!r.read_at,
        createdAt: r.created_at,
      })),
  })
})

/** body: { ids?: string[] }，不传 ids 表示全部标为已读 */
notifications.post('/notifications/read', requireUser, async (c) => {
  const b = await body<{ ids: unknown }>(c)
  const db = c.var.p.db
  const now = Date.now()
  if (Array.isArray(b.ids)) {
    const ids = b.ids.filter((x): x is string => typeof x === 'string').slice(0, 100)
    if (!ids.length) return c.json({ ok: true })
    await db.run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      now,
      c.var.user!.id,
      ...ids,
    )
  } else {
    await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now, c.var.user!.id)
  }
  return c.json({ ok: true })
})

export default notifications
