import type { Platform } from '../types'

/**
 * 文档的自定义链接（slug）：/d/<slug> 和 /d/<文档 ID> 都能打开文档，设置了 slug 的文档以 slug 为准，
 * 用 ID 或改名前的旧 slug 访问时跳转过去。
 */

export const SLUG_MAX = 80
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 文档 ID 是 12 位小写字母和数字，slug 不能和它长得一样，否则无法区分 */
const ID_LIKE = /^[a-z0-9]{12}$/
const RESERVED = new Set(['index'])

/** 文档的阅读页地址 */
export const docPath = (d: { id: string; slug?: string | null }) => `/d/${d.slug || d.id}`

/** 规范化并校验 slug：转小写，空格和下划线换成连字符。空字符串表示清除；不合法时返回错误信息 */
export function parseSlug(input: string): { slug: string | null } | { error: string } {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
  if (!slug) return { slug: null }
  if (slug.length < 2 || slug.length > SLUG_MAX) return { error: `链接长度需要在 2 到 ${SLUG_MAX} 个字符之间` }
  if (!SLUG_RE.test(slug)) return { error: '链接只能包含小写字母、数字和连字符（-），且不能以连字符开头或结尾' }
  if (ID_LIKE.test(slug)) return { error: '链接不能是 12 位纯字母数字（会和文档 ID 混淆），可以加一个连字符' }
  if (RESERVED.has(slug)) return { error: '这个链接是保留的，换一个吧' }
  return { slug }
}

/** 按 ID、当前 slug、旧 slug 的顺序查找文档 */
export async function resolveDocKey(p: Platform, key: string): Promise<{ id: string; slug: string | null } | null> {
  const doc = await p.db.get<{ id: string; slug: string | null }>('SELECT id, slug FROM docs WHERE id = ? OR slug = ? ORDER BY id = ? DESC LIMIT 1', key, key, key)
  if (doc) return doc
  return (
    (await p.db.get<{ id: string; slug: string | null }>('SELECT d.id, d.slug FROM doc_slugs s JOIN docs d ON d.id = s.doc_id WHERE s.slug = ?', key)) ?? null
  )
}

/**
 * 修改文档的 slug。旧 slug 记入历史以便跳转；新 slug 若是别的文档的旧 slug，由本文档接管。
 * 返回需要清除缓存的地址，被其他文档占用时返回 'taken'。
 */
export async function setDocSlug(p: Platform, doc: { id: string; slug: string | null }, slug: string | null): Promise<string[] | 'taken'> {
  if (slug === doc.slug) return []
  if (slug) {
    const owner = await p.db.get<{ id: string }>('SELECT id FROM docs WHERE slug = ? OR id = ?', slug, slug)
    if (owner && owner.id !== doc.id) return 'taken'
  }
  try {
    await p.db.run('UPDATE docs SET slug = ? WHERE id = ?', slug, doc.id)
  } catch (e) {
    // 并发时两篇文档同时抢一个 slug，由唯一索引兜底
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))) return 'taken'
    throw e
  }
  if (slug) await p.db.run('DELETE FROM doc_slugs WHERE slug = ?', slug)
  if (doc.slug) await p.db.run('INSERT INTO doc_slugs (slug, doc_id) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET doc_id = excluded.doc_id', doc.slug, doc.id)
  return [doc.slug, slug].filter((s): s is string => !!s).map((s) => `/d/${s}`)
}
