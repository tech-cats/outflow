import * as Y from 'yjs'
import { fromBase64, newId, toBase64 } from '../lib/crypto'
import { jsonToText, yDocToJSON } from '../lib/prosemirror'
import type { Platform } from '../types'

const REVISION_INTERVAL_MS = 10 * 60 * 1000

export function docCacheKeys(docId: string): string[] {
  return [`/d/${docId}`]
}

export async function loadDocState(p: Platform, docId: string): Promise<Uint8Array | null> {
  const row = await p.db.get<{ ystate: string | null }>('SELECT ystate FROM docs WHERE id = ?', docId)
  return row?.ystate ? fromBase64(row.ystate) : null
}

/** 持久化 Yjs 状态，并派生出只读渲染/搜索所需的 JSON 与纯文本；必要时生成版本快照 */
export async function saveDocState(p: Platform, docId: string, doc: Y.Doc, editorId: string | null) {
  const json = yDocToJSON(doc)
  const content = JSON.stringify(json)
  const text = jsonToText(json).trim()
  const now = Date.now()
  const res = await p.db.run(
    `UPDATE docs SET ystate = ?, content = ?, text = ?, updated_at = ?, updated_by = COALESCE(?, updated_by)
     WHERE id = ?`,
    toBase64(Y.encodeStateAsUpdate(doc)),
    content,
    text,
    now,
    editorId,
    docId,
  )
  if (res.changes === 0) return // 文档已被删除

  const last = await p.db.get<{ created_at: number; content: string }>(
    'SELECT created_at, content FROM revisions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1',
    docId,
  )
  if (!last || (now - last.created_at > REVISION_INTERVAL_MS && last.content !== content)) {
    const doc = await p.db.get<{ title: string }>('SELECT title FROM docs WHERE id = ?', docId)
    await p.db.run(
      'INSERT INTO revisions (id, doc_id, title, content, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      docId,
      doc?.title ?? '',
      content,
      now,
      editorId,
    )
  }
  await p.cache.purge(docCacheKeys(docId))
}
