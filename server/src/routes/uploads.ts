import { Hono } from 'hono'
import { chainReadable, hasRole, loadChain } from '../core/access'
import { newId } from '../lib/crypto'
import type { AppEnv } from '../types'
import { loadDoc } from './docs'
import { fail, rateLimit, requireUser } from './util'

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/** 上传接口挂在 /api 下 */
export const uploadApi = new Hono<AppEnv>()

uploadApi.post('/uploads', requireUser, rateLimit('write'), async (c) => {
  const p = c.var.p
  const form = await c.req.parseBody()
  const file = form.file
  const docId = typeof form.docId === 'string' ? form.docId : ''
  if (!(file instanceof File)) return fail(c, 400, '缺少文件')
  const ext = IMAGE_TYPES[file.type]
  if (!ext) return fail(c, 400, '仅支持 PNG / JPEG / GIF / WebP / AVIF 图片')
  if (file.size > p.config.maxUploadBytes) return fail(c, 413, '文件过大')
  // 不带 docId 的是公开图片（如插件里的地点照片），只有编辑及以上可以上传
  if (docId) {
    const r = await loadDoc(c, docId, 'edit')
    if (r.res) return r.res
  } else if (!hasRole(c.var.user, 'editor')) {
    return fail(c, 403, '需要编辑及以上权限')
  }
  const id = newId(16)
  const key = `u/${id}.${ext}`
  await p.storage.put(key, await file.arrayBuffer(), file.type)
  await p.db.run(
    'INSERT INTO uploads (id, doc_id, key, content_type, size, created_by, created_at, public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    docId || null,
    key,
    file.type,
    file.size,
    c.var.user!.id,
    Date.now(),
    docId ? 0 : 1,
  )
  return c.json({ url: `/uploads/${id}` })
})

/** 文件访问挂在根路径 /uploads/:id，权限跟随所属文档 */
export const uploadFiles = new Hono<AppEnv>()

// 注意不能用 c.notFound()：它会回退到 SPA 的 index.html
const notFound = (c: { text(t: string, s: 404): Response }) => c.text('Not Found', 404)

uploadFiles.get('/uploads/:id', rateLimit('read'), async (c) => {
  const p = c.var.p
  const up = await p.db.get<{ key: string; doc_id: string | null; content_type: string; public: number }>(
    'SELECT key, doc_id, content_type, public FROM uploads WHERE id = ?',
    c.req.param('id'),
  )
  if (!up || (!up.doc_id && !up.public)) return notFound(c)
  const chain = up.doc_id ? await loadChain(p.db, up.doc_id) : []
  if (up.doc_id && !chainReadable(c.var.user, chain)) return notFound(c)
  const obj = await p.storage.get(up.key)
  if (!obj) return notFound(c)
  const isPublic = chain.every((n) => n.visibility === 'public')
  return c.body(obj.body as ArrayBuffer, 200, {
    'Content-Type': up.content_type,
    'Cache-Control': isPublic ? 'public, max-age=86400' : 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  })
})
