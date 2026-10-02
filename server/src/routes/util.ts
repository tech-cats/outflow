import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { GeoScope } from '../config'
import { hasRole } from '../core/access'
import { GEO_SCOPES, getGeoRules, isAllowed } from '../core/geo'
import type { AppEnv, RateBucket, Role } from '../types'

export function fail(c: Context, status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...extra }, status)
}

export function ip(c: Context<AppEnv>): string {
  return c.var.p.clientIp(c.req.raw, c.env)
}

/** 按 IP 限流；登录用户的写操作按用户限流 */
export function rateLimit(bucket: RateBucket): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = bucket === 'write' && c.var.user ? `u:${c.var.user.id}` : `ip:${ip(c)}`
    if (!(await c.var.p.rateLimit.limit(bucket, key))) {
      return fail(c, 429, '请求过于频繁，请稍后再试')
    }
    await next()
  }
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) return fail(c, 401, '请先登录')
  await next()
}

const ROLE_LABEL: Record<Role, string> = { member: '成员', contributor: '贡献者', editor: '编辑', admin: '管理员' }

export function requireRole(role: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.var.user) return fail(c, 401, '请先登录')
    if (!hasRole(c.var.user, role)) return fail(c, 403, `需要${ROLE_LABEL[role]}及以上权限`)
    await next()
  }
}

export const requireAdmin = requireRole('admin')

export async function body<T = Record<string, unknown>>(c: Context): Promise<Partial<T>> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' ? b : {}
  } catch {
    return {}
  }
}

export function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 && s.length <= max ? s : null
}

export function country(c: Context<AppEnv>): string | null {
  return c.var.p.clientCountry(c.req.raw, c.env)
}

/** 地域白名单检查；被拒绝时返回 403 响应，放行时返回 null */
export async function geoBlock(c: Context<AppEnv>, scope: GeoScope): Promise<Response | null> {
  const p = c.var.p
  const rule = (await getGeoRules(p))[scope]
  const cc = country(c)
  if (isAllowed(rule, cc, p.config.geo.unknown)) return null
  return fail(c, 403, `当前地区（${cc ?? '未知'}）暂不开放${GEO_SCOPES[scope]}`, { geo: true, country: cc })
}
