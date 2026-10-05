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

/* ---------------- 站点信息 ---------------- */

/**
 * 站点名、描述和图标，可在管理后台修改（保存在 settings 表）。
 * 未设置时站点名取环境变量 APP_NAME，描述为空，图标使用内置图标。
 */
export interface SiteInfo {
  name: string
  description: string
  /** 上传后的图片地址（/uploads/...）；null 表示使用内置图标 */
  icon: string | null
}

export const SITE_LIMITS = { name: 60, description: 300 }
const SITE_KEYS = { name: 'site.name', description: 'site.description', icon: 'site.icon' } as const

export async function getSiteInfo(p: Platform): Promise<SiteInfo> {
  const rows = await p.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('site.name', 'site.description', 'site.icon')")
  const m = new Map(rows.map((r) => [r.key, r.value]))
  return { name: m.get(SITE_KEYS.name) || p.config.appName, description: m.get(SITE_KEYS.description) ?? '', icon: m.get(SITE_KEYS.icon) || null }
}

/** 校验并规范化，返回错误信息或规范化后的值；name 为空表示恢复为 APP_NAME */
export function normalizeSiteInfo(b: Record<string, unknown>): SiteInfo | string {
  if (typeof b.name !== 'string' || typeof b.description !== 'string' || (b.icon !== null && typeof b.icon !== 'string')) return '参数错误'
  const name = b.name.replace(/\s+/g, ' ').trim()
  const description = b.description.replace(/\s+/g, ' ').trim()
  if (name.length > SITE_LIMITS.name) return `站点名最多 ${SITE_LIMITS.name} 字`
  if (description.length > SITE_LIMITS.description) return `站点描述最多 ${SITE_LIMITS.description} 字`
  // 只接受本站上传的图片，避免引用外部地址
  const icon = (b.icon as string | null) || null
  if (icon && !/^\/uploads\/[a-z0-9]+$/.test(icon)) return '图标地址无效，请重新上传'
  return { name, description, icon }
}

export async function setSiteInfo(p: Platform, info: SiteInfo) {
  const now = Date.now()
  for (const [k, v] of [
    [SITE_KEYS.name, info.name],
    [SITE_KEYS.description, info.description],
    [SITE_KEYS.icon, info.icon ?? ''],
  ] as const) {
    if (!v) await p.db.run('DELETE FROM settings WHERE key = ?', k)
    else
      await p.db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        k,
        v,
        now,
      )
  }
  // 其他页面的匿名缓存最多 60 秒后自然过期
  await p.cache.purge(['/', '/c'])
}
