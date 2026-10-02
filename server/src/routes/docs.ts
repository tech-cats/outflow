import { Hono } from 'hono'
import type { Context } from 'hono'
import { VISIBILITIES, canAddChild, canEditChain, canToggleDraft, chainReadable, effectiveVisibility, filterReadable, loadChain, type DocNode } from '../core/access'
import { docCacheKeys } from '../core/docs'
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
    collectionId: d.collection_id,
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

/* ---------------- 集合 ---------------- */

docs.get('/collections', async (c) => {
  const rows = await c.var.p.db.all(
    'SELECT id, name, description, default_visibility AS defaultVisibility, sort FROM collections ORDER BY sort, created_at',
  )
  return c.json({ collections: rows })
})

docs.post('/collections', requireRole('editor'), rateLimit('write'), async (c) => {
  const b = await body(c)
  const name = str(b.name, 60)
  if (!name) return fail(c, 400, '请填写集合名称')
  const vis = VISIBILITIES.includes(b.defaultVisibility as Visibility) ? (b.defaultVisibility as Visibility) : 'public'
  const id = newId()
  await c.var.p.db.run(
    `INSERT INTO collections (id, name, description, default_visibility, sort, created_by, created_at)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM collections), ?, ?)`,
    id,
    name,
    str(b.description, 500) ?? '',
    vis,
    c.var.user!.id,
    Date.now(),
  )
  return c.json({ id })
})

docs.patch('/collections/:id', requireAdmin, async (c) => {
  const b = await body(c)
  const db = c.var.p.db
  const id = c.req.param('id')
  const name = str(b.name, 60)
  if (name) await db.run('UPDATE collections SET name = ? WHERE id = ?', name, id)
  if (typeof b.description === 'string') await db.run('UPDATE collections SET description = ? WHERE id = ?', b.description.slice(0, 500), id)
  if (VISIBILITIES.includes(b.defaultVisibility as Visibility)) {
    await db.run('UPDATE collections SET default_visibility = ? WHERE id = ?', b.defaultVisibility, id)
  }
  return c.json({ ok: true })
})

docs.delete('/collections/:id', requireAdmin, async (c) => {
  await c.var.p.db.run('DELETE FROM collections WHERE id = ?', c.req.param('id'))
  return c.json({ ok: true })
})

/** 集合的文档树（扁平列表，仅包含当前用户可读的文档） */
docs.get('/collections/:id/tree', rateLimit('read'), async (c) => {
  const rows = await c.var.p.db.all<DocRow>(
    `SELECT ${DOC_COLS} FROM docs WHERE collection_id = ? ORDER BY sort, created_at`,
    c.req.param('id'),
  )
  return c.json({ docs: filterReadable(c.var.user, rows).map(docJson) })
})

/* ---------------- 文档 ---------------- */

docs.post('/docs', requireRole('contributor'), rateLimit('write'), async (c) => {
  const p = c.var.p
  const b = await body(c)
  const col = await p.db.get<{ id: string; default_visibility: Visibility }>(
    'SELECT id, default_visibility FROM collections WHERE id = ?',
    String(b.collectionId ?? ''),
  )
  if (!col) return fail(c, 400, '集合不存在')
  let visibility = col.default_visibility
  let parentId: string | null = null
  if (b.parentId) {
    const r = await loadDoc(c, String(b.parentId), 'read')
    if (r.res) return r.res
    if (!canAddChild(c.var.user, r.chain)) return fail(c, 403, '不能在该文档下新建子文档')
    if (r.doc.collection_id !== col.id) return fail(c, 400, '父文档不属于该集合')
    parentId = r.doc.id
    // 子文档默认继承父文档的可见性（草稿除外）
    visibility = r.doc.visibility === 'draft' ? 'protected' : r.doc.visibility
  }
  const id = newId()
  const now = Date.now()
  await p.db.run(
    `INSERT INTO docs (id, collection_id, parent_id, title, visibility, author_id, sort, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM docs WHERE collection_id = ? AND parent_id IS ?), ?, ?, ?)`,
    id,
    col.id,
    parentId,
    str(b.title, 200) ?? '',
    visibility,
    c.var.user!.id,
    col.id,
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
    collection: col,
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
  if (b.parentId !== undefined || b.sort !== undefined) {
    const parentId = b.parentId === null || b.parentId === '' ? null : String(b.parentId ?? doc.parent_id ?? '') || null
    if (parentId) {
      const target = await loadDoc(c, parentId, 'read')
      if (target.res) return target.res
      if (!canAddChild(user, target.chain)) return fail(c, 403, '不能移动到该文档下')
      if (target.doc.collection_id !== doc.collection_id) return fail(c, 400, '不能移动到其他集合')
      if (target.chain.some((n) => n.id === doc.id)) return fail(c, 400, '不能移动到自己的子文档下')
    }
    const sort = typeof b.sort === 'number' && Number.isFinite(b.sort) ? b.sort : doc.sort
    await p.db.run('UPDATE docs SET parent_id = ?, sort = ? WHERE id = ?', parentId, sort, doc.id)
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
