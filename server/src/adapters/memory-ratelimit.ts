import type { RateBucket, RateLimiter } from '../types'

/** 每分钟次数，默认值与 wrangler.toml 中 [[ratelimits]] 一致 */
export const DEFAULT_RATE_LIMITS: Record<RateBucket, number> = { auth: 10, write: 120, read: 300 }

/**
 * 进程内固定窗口限流。可用 RATE_LIMIT_AUTH / RATE_LIMIT_WRITE / RATE_LIMIT_READ 调整，
 * 例如校园网大量用户共用出口 IP 时适当调高 RATE_LIMIT_AUTH。
 */
export function memoryRateLimiter(env: Record<string, unknown> = {}): RateLimiter {
  const RATE_LIMITS = Object.fromEntries(
    (Object.keys(DEFAULT_RATE_LIMITS) as RateBucket[]).map((b) => {
      const v = Number(env[`RATE_LIMIT_${b.toUpperCase()}`])
      return [b, { limit: Number.isFinite(v) && v > 0 ? v : DEFAULT_RATE_LIMITS[b], periodMs: 60_000 }]
    }),
  ) as Record<RateBucket, { limit: number; periodMs: number }>
  const hits = new Map<string, { count: number; reset: number }>()
  let lastSweep = Date.now()
  return {
    async limit(bucket, key) {
      const now = Date.now()
      if (now - lastSweep > 60_000) {
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
        lastSweep = now
      }
      const { limit, periodMs } = RATE_LIMITS[bucket]
      const k = `${bucket}:${key}`
      const cur = hits.get(k)
      if (!cur || cur.reset < now) {
        hits.set(k, { count: 1, reset: now + periodMs })
        return true
      }
      cur.count++
      return cur.count <= limit
    },
  }
}
