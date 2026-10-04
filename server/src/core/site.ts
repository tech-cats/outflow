import type { Platform } from '../types'

/**
 * 首页文档：固定 id 的一篇文档，存在且当前用户可读时显示在 /，否则首页显示集合列表。
 * 它不出现在集合的文档树和列表中，也不能有子文档。普通文档 id 是 12 位随机串，不会与它冲突。
 */
export const HOME_DOC_ID = 'index'

/** 创建首页文档，归属排序最靠前的集合（只影响权限继承，不会显示在该集合中） */
export async function createHomeDoc(p: Platform, userId: string): Promise<'ok' | 'exists' | 'no-collection'> {
  if (await p.db.get('SELECT 1 FROM docs WHERE id = ?', HOME_DOC_ID)) return 'exists'
  const col = await p.db.get<{ id: string }>('SELECT id FROM collections ORDER BY sort, created_at LIMIT 1')
  if (!col) return 'no-collection'
  const now = Date.now()
  await p.db.run(
    `INSERT INTO docs (id, collection_id, parent_id, title, visibility, author_id, sort, created_at, updated_at, updated_by)
     VALUES (?, ?, NULL, ?, 'public', ?, 0, ?, ?, ?)`,
    HOME_DOC_ID,
    col.id,
    '首页',
    userId,
    now,
    now,
    userId,
  )
  await p.cache.purge(['/'])
  return 'ok'
}
