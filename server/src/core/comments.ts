import type { DB, User } from '../types'
import { hasRole } from './access'

export interface CommentJson {
  id: string
  parentId: string | null
  authorId: string
  authorName: string | null
  body: string
  anchor: string | null
  quote: string | null
  resolved: boolean
  createdAt: number
}

export const MAX_COMMENT_LENGTH = 2000
export const MAX_QUOTE_LENGTH = 500

/** 文档的全部评论，按时间正序 */
export async function listComments(db: DB, docId: string): Promise<CommentJson[]> {
  const rows = await db.all<{
    id: string
    parent_id: string | null
    author_id: string
    author_name: string | null
    body: string
    anchor: string | null
    quote: string | null
    resolved: number
    created_at: number
  }>(
    `SELECT c.id, c.parent_id, c.author_id, u.name AS author_name, c.body, c.anchor, c.quote, c.resolved, c.created_at
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.doc_id = ? ORDER BY c.created_at LIMIT 2000`,
    docId,
  )
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    anchor: r.anchor,
    quote: r.quote,
    resolved: !!r.resolved,
    createdAt: r.created_at,
  }))
}

/** 删除评论：作者本人，或编辑及以上（管理讨论） */
export function canDeleteComment(user: User | null, authorId: string): boolean {
  return !!user && (user.id === authorId || hasRole(user, 'editor'))
}

/** 解决 / 重新打开：发起人，或能编辑该文档的人 */
export function canResolveComment(user: User | null, authorId: string, canEditDoc: boolean): boolean {
  return !!user && (user.id === authorId || canEditDoc || hasRole(user, 'editor'))
}

/** 校验行内批注锚点：{"from": base64, "to": base64} */
export function parseAnchor(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 1000) return null
  try {
    const a = JSON.parse(v)
    const b64 = /^[A-Za-z0-9+/]{1,400}={0,2}$/
    if (typeof a?.from !== 'string' || typeof a?.to !== 'string' || !b64.test(a.from) || !b64.test(a.to)) return null
    return JSON.stringify({ from: a.from, to: a.to })
  } catch {
    return null
  }
}
