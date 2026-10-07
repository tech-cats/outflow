import { Hono } from 'hono'
import type { Context } from 'hono'
import { VISIBILITIES, canAddChild, canEditChain, canToggleDraft, chainReadable, effectiveVisibility, filterReadable, loadChain, type DocNode } from '../core/access'
import { docCacheKeys } from '../core/docs'
import { HOME_DOC_ID } from '../core/site'
import { TOPIC_NAME_MAX, createTopic, defaultTopic, listTopics, moveSubtreeToTopic } from '../core/topics'
import { searchDocs } from '../core/search'
import { newId } from '../lib/crypto'
import { jsonToHtml, jsonToMarkdown } from '../lib/prosemirror'
import type { AppEnv, PMNode, Visibility } from '../types'
import { body, fail, rateLimit, requireAdmin, requireRole, requireUser, str } from './util'

const docs = new Hono<AppEnv>()

interface DocRow extends DocNode {
  collection_id: string
  title: string
  locked: number
  sort: number
  created_at: number
  updated_at: number
  updated_by: string | null
}

const DOC_COLS = 'id, collection_id, parent_id, title, visibility, locked, author_id, sort, created_at, updated_at, updated_by'

function docJson(d: DocRow) {
  return {
    id: d.id,
    topicId: d.collection_id,
    parentId: d.parent_id,
    title: d.title,
    visibility: d.visibility,
    locked: !!d.locked,
    authorId: d.author_id,
    sort: d.sort,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

/** 读取文档并做权限检查；失败时返回 Response */
async function loadDoc(c: Context<AppEnv>, id: string, need: 'read' | 'edit') {
  const p = c.var.p
  const doc = await p.db.get<DocRow>(`SELECT ${DOC_COLS} FROM docs WHERE id = ?`, id)
  if (!doc) return { res: fail(c, 404, '文档不存在') }
  const chain = await loadChain(p.db, id)
  if (!chainReadable(c.var.user, chain)) {
    return { res: c.var.user ? fail(c, 404, '文档不存在') : fail(c, 401, '请先登录') }
  }
  const canEdit = canEditChain(c.var.user, chain)
  if (need === 'edit' && !canEdit) {
    return { res: fail(c, 403, doc.locked ? '文档已锁定，仅管理员可编辑' : '没有编辑权限') }
  }
  return { doc, chain, canEdit }
}

/* ---------------- 主题 ---------------- */

docs.get('/topics', async (c) => c.json({ topics: await listTopics(c.var.p) }))

docs.post('/topics', requireRole('editor'), rateLimit('write'), async (c) => {
  const name = str((await body(c)).name, TOPIC_NAME_MAX)
  if (!name) return fail(c, 400, '请填写主题名称')
  return c.json({ id: await createTopic(c.var.p, name, c.var.user!.id) })
})

docs.patch('/topics/:id', requireRole('editor'), async (c) => {
  const b = await body(c)
  const p = c.var.p
  const id = c.req.param('id')
  const name = str(b.name, TOPIC_NAME_MAX)
  if (name) await p.db.run('UPDATE collections SET name = ? WHERE id = ?', name, id)
  if (typeof b.sort === 'number' && Number.isFinite(b.sort)) await p.db.run('UPDATE collections SET sort = ? WHERE id = ?', b.sort, id)
  await p.cache.purge(['/', '/c', `/c/${id}`])
  return c.json({ ok: true })
})

/** 只能删除空主题，避免误删文档；首页文档会被挪到其他主题 */
docs.delete('/topics/:id', requireAdmin, async (c) => {
  const p = c.var.p
  const id = c.req.param('id')
  const n = await p.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM docs WHERE collection_id = ? AND id != ?', id, HOME_DOC_ID)
  if (n?.n) return fail(c, 400, `该主题下还有 ${n.n} 篇文档，请先移到其他主题`)
  if (await p.db.get('SELECT 1 FROM docs WHERE id = ? AND collection_id = ?', HOME_DOC_ID, id)) {
    const other = await p.db.get<{ id: string }>('SELECT id FROM collections WHERE id != ? ORDER BY sort, created_at LIMIT 1', id)
    if (!other) return fail(c, 400, '至少要保留一个主题')
    await moveSubtreeToTopic(p, HOME_DOC_ID, other.id)
  }
  await p.db.run('DELETE FROM collections WHERE id = ?', id)
  await p.cache.purge(['/', '/c', `/c/${id}`])
  return c.json({ ok: true })
})

/** 全站文档树：全部主题，以及当前用户可读的文档（扁平列表，首页文档除外） */
docs.get('/tree', rateLimit('read'), async (c) => {
  const p = c.var.p
  const [topics, rows] = await Promise.all([
    listTopics(p),
    p.db.all<DocRow>(`SELECT ${DOC_COLS} FROM docs WHERE id != ? ORDER BY sort, created_at`, HOME_DOC_ID),
  ])
  return c.json({ topics, docs: filterReadable(c.var.user, rows).map(docJson) })
})

/* ---------------- 文档 ---------------- */

docs.post('/docs', requireRole('contributor'), rateLimit('write'), async (c) => {
  const p = c.var.p
  const b = await body(c)
  let topicId: string
  let visibility: Visibility = 'public'
  let parentId: string | null = null
  if (b.parentId) {
    const r = await loadDoc(c, String(b.parentId), 'read')
    if (r.res) return r.res
    if (!canAddChild(c.var.user, r.chain)) return fail(c, 403, '不能在该文档下新建子文档')
    parentId = r.doc.id
    topicId = r.doc.collection_id
    // 子文档默认继承父文档的可见性（草稿除外）
    visibility = r.doc.visibility === 'draft' ? 'protected' : r.doc.visibility
  } else if (b.topicId) {
    const t = await p.db.get<{ id: string }>('SELECT id FROM collections WHERE id = ?', String(b.topicId))
    if (!t) return fail(c, 400, '主题不存在')
    topicId = t.id
  } else {
    topicId = await defaultTopic(p, c.var.user!.id)
  }
  const id = newId()
  const now = Date.now()
  await p.db.run(
    `INSERT INTO docs (id, collection_id, parent_id, title, visibility, author_id, sort, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM docs WHERE collection_id = ? AND parent_id IS ?), ?, ?, ?)`,
    id,
    topicId,
    parentId,
    str(b.title, 200) ?? '',
    visibility,
    c.var.user!.id,
    topicId,
    parentId,
    now,
    now,
    c.var.user!.id,
  )
  return c.json({ id })
})

docs.get('/docs/:id', rateLimit('read'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  const p = c.var.p
  const [col, crumbs, users] = await Promise.all([
    p.db.get('SELECT id, name FROM collections WHERE id = ?', r.doc.collection_id),
    Promise.all(r.chain.slice(1).reverse().map((n) => p.db.get<{ id: string; title: string }>('SELECT id, title FROM docs WHERE id = ?', n.id))),
    p.db.all<{ id: string; name: string }>('SELECT id, name FROM users WHERE id IN (?, ?)', r.doc.author_id, r.doc.updated_by),
  ])
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null
  return c.json({
    doc: {
      ...docJson(r.doc),
      effectiveVisibility: effectiveVisibility(r.chain),
      authorName: name(r.doc.author_id),
      updatedByName: name(r.doc.updated_by),
    },
    topic: col,
    breadcrumbs: crumbs.filter(Boolean),
    canEdit: r.canEdit,
    canDraft: r.canEdit && canToggleDraft(c.var.user, r.doc),
  })
})

/** 供公开页轮询“是否有更新” */
docs.get('/docs/:id/version', rateLimit('read'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  c.header('Cache-Control', 'no-store')
  return c.json({ updatedAt: r.doc.updated_at })
})

docs.patch('/docs/:id', requireUser, rateLimit('write'), async (c) => {
  const p = c.var.p
  const user = c.var.user!
  const r = await loadDoc(c, c.req.param('id'), 'edit')
  if (r.res) return r.res
  const b = await body(c)
  const doc = r.doc
  const canDraft = canToggleDraft(user, doc)

  if (typeof b.title === 'string') {
    await p.db.run('UPDATE docs SET title = ?, updated_at = ?, updated_by = ? WHERE id = ?', b.title.trim().slice(0, 200), Date.now(), user.id, doc.id)
  }
  if (b.visibility !== undefined) {
    if (!VISIBILITIES.includes(b.visibility as Visibility)) return fail(c, 400, '可见性参数错误')
    // 只有作者和管理员能设为草稿（草稿只有作者可见）
    if (b.visibility === 'draft' && !canDraft) return fail(c, 403, '只有作者或管理员可以设为草稿')
    if (doc.visibility === 'draft' && !canDraft) return fail(c, 403, '只有作者或管理员可以发布草稿')
    await p.db.run('UPDATE docs SET visibility = ? WHERE id = ?', b.visibility, doc.id)
  }
  if (b.locked !== undefined) {
    if (user.role !== 'admin') return fail(c, 403, '只有管理员可以锁定文档')
    await p.db.run('UPDATE docs SET locked = ? WHERE id = ?', b.locked ? 1 : 0, doc.id)
  }
  if (b.parentId !== undefined || b.sort !== undefined || b.topicId !== undefined) {
    if (doc.id === HOME_DOC_ID) return fail(c, 400, '首页文档不能移动')
    // 只指定了新主题时，移到该主题的顶级
    const toTopicTop = b.parentId === undefined && b.topicId !== undefined && b.topicId !== doc.collection_id
    const parentId = toTopicTop || b.parentId === null || b.parentId === '' ? null : String(b.parentId ?? doc.parent_id ?? '') || null
    // 有父文档时跟随父文档的主题；移到顶级时可以同时换主题
    let topicId = doc.collection_id
    if (parentId) {
      const target = await loadDoc(c, parentId, 'read')
      if (target.res) return target.res
      if (!canAddChild(user, target.chain)) return fail(c, 403, '不能移动到该文档下')
      if (target.chain.some((n) => n.id === doc.id)) return fail(c, 400, '不能移动到自己的子文档下')
      topicId = target.doc.collection_id
    } else if (b.topicId !== undefined) {
      const t = await p.db.get<{ id: string }>('SELECT id FROM collections WHERE id = ?', String(b.topicId))
      if (!t) return fail(c, 400, '主题不存在')
      topicId = t.id
    }
    let sort = typeof b.sort === 'number' && Number.isFinite(b.sort) ? b.sort : doc.sort
    // 换了位置但没指定顺序时排到最后
    if (b.sort === undefined && (parentId !== doc.parent_id || topicId !== doc.collection_id)) {
      const last = await p.db.get<{ s: number | null }>('SELECT MAX(sort) AS s FROM docs WHERE collection_id = ? AND parent_id IS ?', topicId, parentId)
      sort = (last?.s ?? 0) + 1
    }
    await p.db.run('UPDATE docs SET parent_id = ?, sort = ? WHERE id = ?', parentId, sort, doc.id)
    if (topicId !== doc.collection_id) {
      await moveSubtreeToTopic(p, doc.id, topicId)
      await p.cache.purge([`/c/${doc.collection_id}`, `/c/${topicId}`])
    }
  }
  await p.cache.purge(docCacheKeys(doc.id))
  return c.json({ ok: true })
})

docs.delete('/docs/:id', requireUser, rateLimit('write'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'edit')
  if (r.res) return r.res
  const user = c.var.user!
  const childCount = await c.var.p.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM docs WHERE parent_id = ?', r.doc.id)
  if (childCount?.n && user.role !== 'admin') return fail(c, 400, '请先删除或移走子文档（只有管理员可以连同子文档一起删除）')
  await c.var.p.db.run('DELETE FROM docs WHERE id = ?', r.doc.id)
  await c.var.p.cache.purge(docCacheKeys(r.doc.id))
  return c.json({ ok: true })
})

docs.get('/docs/:id/export.md', rateLimit('read'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  const row = await c.var.p.db.get<{ content: string | null }>('SELECT content FROM docs WHERE id = ?', r.doc.id)
  const json: PMNode = row?.content ? JSON.parse(row.content) : { type: 'doc' }
  const filename = encodeURIComponent((r.doc.title || 'untitled').replace(/[\\/:*?"<>|]/g, '_')) + '.md'
  return c.body(jsonToMarkdown(r.doc.title, json), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
  })
})

/* ---------------- 版本历史 ---------------- */

docs.get('/docs/:id/revisions', requireUser, async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  const rows = await c.var.p.db.all(
    `SELECT r.id, r.title, r.created_at AS createdAt, u.name AS createdByName
     FROM revisions r LEFT JOIN users u ON u.id = r.created_by
     WHERE r.doc_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    r.doc.id,
  )
  return c.json({ revisions: rows })
})

docs.get('/docs/:id/revisions/:rid', requireUser, async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  const rev = await c.var.p.db.get<{ title: string; content: string; created_at: number }>(
    'SELECT title, content, created_at FROM revisions WHERE id = ? AND doc_id = ?',
    c.req.param('rid'),
    r.doc.id,
  )
  if (!rev) return fail(c, 404, '版本不存在')
  return c.json({ title: rev.title, createdAt: rev.created_at, html: jsonToHtml(JSON.parse(rev.content)) })
})

docs.post('/docs/:id/revisions/:rid/restore', requireUser, rateLimit('write'), async (c) => {
  const r = await loadDoc(c, c.req.param('id'), 'edit')
  if (r.res) return r.res
  const rev = await c.var.p.db.get<{ content: string }>(
    'SELECT content FROM revisions WHERE id = ? AND doc_id = ?',
    c.req.param('rid'),
    r.doc.id,
  )
  if (!rev) return fail(c, 404, '版本不存在')
  await c.var.p.collab.replace(r.doc.id, JSON.parse(rev.content), c.var.user!.id)
  return c.json({ ok: true })
})

/* ---------------- 搜索 ---------------- */

docs.get('/search', rateLimit('read'), async (c) => {
  return c.json({ results: await searchDocs(c.var.p, c.var.user, c.req.query('q') ?? '') })
})

/* ---------------- 实时协作 ---------------- */

docs.get('/collab/:id', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return fail(c, 426, 'expected websocket')
  // 防止跨站 WebSocket 劫持
  const origin = c.req.header('Origin')
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return fail(c, 403, 'bad origin')
  const r = await loadDoc(c, c.req.param('id'), 'read')
  if (r.res) return r.res
  if (!c.var.user) return fail(c, 401, '请先登录')
  if (!c.var.p.collab.upgrade) return fail(c, 500, 'collab not available')
  return c.var.p.collab.upgrade(c.req.raw, r.doc.id, { readonly: !r.canEdit, userId: c.var.user.id })
})

export { loadDoc }
export default docs
