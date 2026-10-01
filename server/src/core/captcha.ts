import { createChallenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/web/sha'
import { verify as altchaVerify } from 'altcha-lib/frameworks/shared'
import type { Platform } from '../types'

/**
 * 可插拔人机验证：
 *  altcha    —— 自托管工作量证明（默认，不依赖任何第三方）
 *  turnstile —— Cloudflare Turnstile
 *  hcaptcha  —— hCaptcha
 *  none      —— 关闭（仅限开发环境）
 */

const ALTCHA_TTL_S = 10 * 60

function altchaSecret(p: Platform) {
  return p.config.captcha.secret || `${p.config.sessionSecret}:altcha`
}

export async function createAltchaChallenge(p: Platform) {
  return createChallenge({
    algorithm: 'SHA-256',
    cost: 1,
    // 前缀 4 个十六进制 0 ≈ 65536 次哈希，浏览器内约 0.5~1 秒
    keyPrefix: '0000',
    deriveKey,
    expiresAt: Math.floor(Date.now() / 1000) + ALTCHA_TTL_S,
    hmacSignatureSecret: altchaSecret(p),
  })
}

/** 用数据库记录已使用的 challenge，防止重放 */
function replayStore(p: Platform) {
  return {
    async get(id: string) {
      return !!(await p.db.get('SELECT 1 AS x FROM captcha_used WHERE id = ?', id))
    },
    async set(id: string) {
      const now = Date.now()
      await p.db.run('DELETE FROM captcha_used WHERE expires_at < ?', now)
      await p.db.run(
        'INSERT OR IGNORE INTO captcha_used (id, expires_at) VALUES (?, ?)',
        id,
        now + (ALTCHA_TTL_S + 60) * 1000,
      )
    },
  }
}

async function siteverify(url: string, secret: string, token: string, ip?: string): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)
  const res = await fetch(url, { method: 'POST', body })
  if (!res.ok) return false
  const data = (await res.json()) as { success?: boolean }
  return data.success === true
}

export async function verifyCaptcha(p: Platform, token: unknown, ip?: string): Promise<boolean> {
  const { provider, secret } = p.config.captcha
  if (provider === 'none') return true
  if (typeof token !== 'string' || !token || token.length > 8192) return false
  try {
    switch (provider) {
      case 'altcha': {
        const r = await altchaVerify(token, deriveKey, altchaSecret(p), undefined, replayStore(p))
        return !r.error
      }
      case 'turnstile':
        return siteverify('https://challenges.cloudflare.com/turnstile/v0/siteverify', secret, token, ip)
      case 'hcaptcha':
        return siteverify('https://api.hcaptcha.com/siteverify', secret, token, ip)
    }
  } catch (err) {
    console.error('captcha verify error', err)
  }
  return false
}
