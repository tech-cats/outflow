import type { RateBucket, RateLimiter } from '../types'

/** 与 wrangler.toml 中 [[ratelimits]] 保持一致的进程内固定窗口限流 */
export const RATE_LIMITS: Record<RateBucket, { limit: number; periodMs: number }> = {
  auth: { limit: 10, periodMs: 60_000 },
  write: { limit: 120, periodMs: 60_000 },
  read: { limit: 300, periodMs: 60_000 },
}

export function memoryRateLimiter(): RateLimiter {
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
