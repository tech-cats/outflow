import { newId } from '../lib/crypto'
import type { Platform } from '../types'

/**
 * 主题：文档的轻量分组，只有名称和顺序（数据表沿用早期的 collections）。
 * 每篇文档都属于一个主题；子文档总是和父文档同属一个主题。
 */

export const TOPIC_NAME_MAX = 60
const DEFAULT_TOPIC = '未分类'

export interface Topic {
  id: string
  name: string
  sort: number
}

export async function listTopics(p: Platform): Promise<Topic[]> {
  return p.db.all<Topic>('SELECT id, name, sort FROM collections ORDER BY sort, created_at')
}

export async function createTopic(p: Platform, name: string, userId: string | null): Promise<string> {
  const id = newId()
  await p.db.run(
    `INSERT INTO collections (id, name, sort, created_by, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM collections), ?, ?)`,
    id,
    name,
    userId,
    Date.now(),
  )
  return id
}

/** 排序最靠前的主题；一个主题都没有时自动创建「未分类」，这样写文档前不必先建主题 */
export async function defaultTopic(p: Platform, userId: string | null): Promise<string> {
  const row = await p.db.get<{ id: string }>('SELECT id FROM collections ORDER BY sort, created_at LIMIT 1')
  return row?.id ?? createTopic(p, DEFAULT_TOPIC, userId)
}

/** 把文档连同全部子孙移到另一个主题 */
export async function moveSubtreeToTopic(p: Platform, docId: string, topicId: string) {
  await p.db.run(
    `WITH RECURSIVE sub(id, depth) AS (
       SELECT id, 0 FROM docs WHERE id = ?
       UNION ALL
       SELECT d.id, s.depth + 1 FROM docs d JOIN sub s ON d.parent_id = s.id WHERE s.depth < 64
     ) UPDATE docs SET collection_id = ? WHERE id IN (SELECT id FROM sub)`,
    docId,
    topicId,
  )
}
