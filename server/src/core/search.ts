import type { Platform, User } from '../types'
import { chainReadable, loadChain } from './access'

export interface SearchResult {
  id: string
  title: string
  collectionName: string
  snippet: string
  updatedAt: number
}

/** MVP：LIKE 子串匹配（对中文友好，无需分词）；数据量大后可换 FTS5 trigram */
export async function searchDocs(p: Platform, user: User | null, query: string): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 100)
  if (!q) return []
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
  const rows = await p.db.all<{ id: string; title: string; text: string; updated_at: number; collection_name: string }>(
    `SELECT d.id, d.title, d.text, d.updated_at, c.name AS collection_name
     FROM docs d JOIN collections c ON c.id = d.collection_id
     WHERE d.title LIKE ? ESCAPE '\\' OR d.text LIKE ? ESCAPE '\\'
     ORDER BY (d.title LIKE ? ESCAPE '\\') DESC, d.updated_at DESC LIMIT 200`,
    like,
    like,
    like,
  )
  const results: SearchResult[] = []
  const lower = q.toLowerCase()
  for (const d of rows) {
    if (results.length >= 30) break
    if (!chainReadable(user, await loadChain(p.db, d.id))) continue
    const idx = d.text.toLowerCase().indexOf(lower)
    const start = Math.max(0, idx - 40)
    results.push({
      id: d.id,
      title: d.title,
      collectionName: d.collection_name,
      snippet: idx >= 0 ? (start > 0 ? '…' : '') + d.text.slice(start, idx + q.length + 80) : d.text.slice(0, 120),
      updatedAt: d.updated_at,
    })
  }
  return results
}
