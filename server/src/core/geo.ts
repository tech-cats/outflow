import { parseCountries, type GeoScope } from '../config'
import type { Platform } from '../types'

/**
 * 通用地域白名单：每个范围（scope）一份国家/地区列表，空列表表示不限制。
 * 默认值来自环境变量，管理后台写入 settings 表后覆盖默认值。
 * 新增范围：在 GEO_SCOPES 加一项，并在对应接口调用 geoGuard。
 */

export const GEO_SCOPES: Record<GeoScope, string> = {
  register: '注册',
  login: '登录与找回密码',
}

export interface GeoRule {
  countries: string[]
  source: 'env' | 'admin'
}

const key = (scope: GeoScope) => `geo.${scope}`

export async function getGeoRules(p: Platform): Promise<Record<GeoScope, GeoRule>> {
  const rows = await p.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'geo.%'")
  const stored = new Map(rows.map((r) => [r.key, r.value]))
  const out = {} as Record<GeoScope, GeoRule>
  for (const scope of Object.keys(GEO_SCOPES) as GeoScope[]) {
    const v = stored.get(key(scope))
    out[scope] = v === undefined ? { countries: p.config.geo.defaults[scope], source: 'env' } : { countries: parseCountries(v), source: 'admin' }
  }
  return out
}

/** countries 为 null 表示删除覆盖、恢复环境变量默认值 */
export async function setGeoRule(p: Platform, scope: GeoScope, countries: string[] | null) {
  if (countries === null) {
    await p.db.run('DELETE FROM settings WHERE key = ?', key(scope))
    return
  }
  await p.db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key(scope),
    countries.join(','),
    Date.now(),
  )
}

export function isAllowed(rule: GeoRule, country: string | null, unknown: 'allow' | 'deny'): boolean {
  if (!rule.countries.length) return true
  if (!country) return unknown === 'allow'
  return rule.countries.includes(country)
}

/** 当前请求在哪些范围被拒绝（供前端提前提示） */
export async function blockedScopes(p: Platform, country: string | null): Promise<GeoScope[]> {
  const rules = await getGeoRules(p)
  return (Object.keys(rules) as GeoScope[]).filter((s) => !isAllowed(rules[s], country, p.config.geo.unknown))
}
