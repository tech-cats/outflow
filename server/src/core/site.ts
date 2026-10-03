import type { Platform } from '../types'

/**
 * 站点级设置（保存在 settings 表）。
 * site.home：作为首页内容的文档 id；未设置、文档已删除或当前用户无权阅读时，首页显示集合列表。
 */
const HOME_KEY = 'site.home'

export async function getHomeDocId(p: Platform): Promise<string | null> {
  const row = await p.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', HOME_KEY)
  return row?.value || null
}

export async function setHomeDocId(p: Platform, docId: string | null) {
  if (!docId) {
    await p.db.run('DELETE FROM settings WHERE key = ?', HOME_KEY)
  } else {
    await p.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      HOME_KEY,
      docId,
      Date.now(),
    )
  }
  await p.cache.purge(['/'])
}
