import { Hono } from 'hono'
import { chainReadable, hasRole } from '../core/access'
import {
  MAX_COMMENT_LENGTH,
  MAX_QUOTE_LENGTH,
  canDeleteComment,
  canResolveComment,
  listComments,
  parseAnchor,
} from '../core/comments'
import { mentionNames, notify } from '../core/notify'
import { newId } from '../lib/crypto'
import type { AppEnv, Role } from '../types'
import { loadDoc } from './docs'
import { body, fail, rateLimit, requireUser } from './util'

/** 评论只对能读到文档的登录用户可见；任何登录用户（成员及以上）都可以评论 */
const comments = new Hono<AppEnv>()

comments.get('/docs/:id/comments', requireUser, rateLimit('read'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  c.header('Cache-Control', 'no-store')
  const list = await listComments(c.var.p.db, r.doc.id)
  return c.json({
    comments: list,
    mentions: await mentionNames(c.var.p, list.map((x) => x.body)),
    canModerate: hasRole(c.var.user, 'editor'),
    canResolveAll: r.canEdit || hasRole(c.var.user, 'editor'),
  })
})

comments.post('/docs/:id/comments', requireUser, rateLimit('write'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  const p = c.var.p
  const b = await body(c)
  const text = typeof b.body === 'string' ? b.body.trim() : ''
  if (!text) return fail(c, 400, '评论不能为空')
  if (text.length > MAX_COMMENT_LENGTH) return fail(c, 400, `评论不能超过 ${MAX_COMMENT_LENGTH} 字`)

  let parentId: string | null = null
  let anchor: string | null = null
  let quote: string | null = null
  if (b.parentId) {
    const parent = await p.db.get<{ id: string; parent_id: string | null }>(
      'SELECT id, parent_id FROM comments WHERE id = ? AND doc_id = ?',
      String(b.parentId),
      r.doc.id,
    )
    if (!parent) return fail(c, 404, '评论不存在')
    parentId = parent.parent_id ?? parent.id
  } else if (b.anchor !== undefined && b.anchor !== null) {
    anchor = parseAnchor(b.anchor)
    if (!anchor) return fail(c, 400, '批注位置无效')
    quote = typeof b.quote === 'string' ? b.quote.trim().slice(0, MAX_QUOTE_LENGTH) : ''
  }

  const id = newId()
  await p.db.run(
    `INSERT INTO comments (id, doc_id, parent_id, author_id, body, anchor, quote, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    r.doc.id,
    parentId,
    c.var.user!.id,
    text,
    anchor,
    quote,
    Date.now(),
  )
  await notify(p, { type: 'comment.created', actor: c.var.user!, docId: r.doc.id, commentId: id })
  return c.json({ id })
})

/** @ 提及候选：只列出能读到这篇文档的用户 */
comments.get('/docs/:id/mentionable', requireUser, rateLimit('read'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  const q = (c.req.query('q') ?? '').trim().slice(0, 30).replace(/[%_\\]/g, (m) => '\\' + m)
  const rows = await c.var.p.db.all<{ id: string; email: string; name: string; role: Role }>(
    `SELECT id, email, name, role FROM users WHERE disabled = 0 AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 50`,
    `%${q}%`,
  )
  const users = rows.filter((u) => u.id !== c.var.user!.id && chainReadable(u, r.chain)).slice(0, 8)
  return c.json({ users: users.map((u) => ({ id: u.id, name: u.name })) })
})

async function loadComment(c: Parameters<typeof loadDoc>[0], id: string) {
  const row = await c.var.p.db.get<{ id: string; doc_id: string; parent_id: string | null; author_id: string }>(
    'SELECT id, doc_id, parent_id, author_id FROM comments WHERE id = ?',
    id,
  )
  if (!row) return { res: fail(c, 404, '评论不存在') }
  const r = await loadDoc(c, row.doc_id, 'read')
  if (r.res) return { res: r.res }
  return { row, canEditDoc: r.canEdit }
}

comments.patch('/comments/:id', requireUser, rateLimit('write'), async (c) => {
  const r = await loadComment(c, c.req.param('id'))
  if (r.res) return r.res
  const b = await body(c)
  if (typeof b.resolved !== 'boolean') return fail(c, 400, '参数错误')
  if (r.row.parent_id) return fail(c, 400, '只能解决整条讨论')
  if (!canResolveComment(c.var.user, r.row.author_id, r.canEditDoc)) return fail(c, 403, '没有权限')
  await c.var.p.db.run(
    'UPDATE comments SET resolved = ?, resolved_by = ? WHERE id = ?',
    b.resolved ? 1 : 0,
    b.resolved ? c.var.user!.id : null,
    r.row.id,
  )
  if (b.resolved) await notify(c.var.p, { type: 'comment.resolved', actor: c.var.user!, docId: r.row.doc_id, commentId: r.row.id })
  return c.json({ ok: true })
})

comments.delete('/comments/:id', requireUser, rateLimit('write'), async (c) => {
  const r = await loadComment(c, c.req.param('id'))
  if (r.res) return r.res
  if (!canDeleteComment(c.var.user, r.row.author_id)) return fail(c, 403, '只能删除自己的评论')
  // 删除根评论时回复一并删除（外键级联）
  await c.var.p.db.run('DELETE FROM comments WHERE id = ?', r.row.id)
  return c.json({ ok: true })
})

export default comments
