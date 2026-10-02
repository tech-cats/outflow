import { base64url, newId, randomBytes, randomDigits, sha256Hex, timingSafeEqual } from '../lib/crypto'
import { isEmailAllowed } from '../lib/email-rules'
import type { Platform, User } from '../types'

export const SESSION_COOKIE = 'outflow_session'
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000

/* ---------------- 会话 ---------------- */

export async function createSession(p: Platform, userId: string): Promise<string> {
  const token = base64url(randomBytes(32))
  const now = Date.now()
  await p.db.run(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    await sha256Hex(token),
    userId,
    now + SESSION_TTL_MS,
    now,
  )
  return token
}

export async function getSessionUser(p: Platform, token: string | undefined): Promise<User | null> {
  if (!token || token.length > 100) return null
  return p.db.get<User>(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`,
    await sha256Hex(token),
    Date.now(),
  )
}

export async function deleteSession(p: Platform, token: string) {
  await p.db.run('DELETE FROM sessions WHERE id = ?', await sha256Hex(token))
}

/* ---------------- 邮箱白名单 ---------------- */

export async function getEmailRules(p: Platform): Promise<{ env: string[]; db: string[] }> {
  const rows = await p.db.all<{ pattern: string }>('SELECT pattern FROM email_rules ORDER BY created_at')
  return { env: p.config.allowedEmails, db: rows.map((r) => r.pattern) }
}

export async function emailAllowed(p: Platform, email: string): Promise<boolean> {
  const rules = await getEmailRules(p)
  return isEmailAllowed(email, [...rules.env, ...rules.db])
}

/* ---------------- 邮箱验证码 ---------------- */

export type CodePurpose = 'register' | 'reset'
const CODE_TTL_MS = 10 * 60 * 1000
const CODE_COOLDOWN_MS = 60 * 1000
const CODE_MAX_ATTEMPTS = 5
const CODE_DAILY_LIMIT = 10

async function codeHash(p: Platform, email: string, purpose: string, code: string) {
  return sha256Hex(`${p.config.sessionSecret}:${purpose}:${email}:${code}`)
}

export type IssueResult = { ok: true; code: string } | { ok: false; error: string; retryAfter?: number }

export async function issueEmailCode(p: Platform, email: string, purpose: CodePurpose): Promise<IssueResult> {
  const now = Date.now()
  const recent = await p.db.get<{ n: number; last: number | null }>(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM email_codes WHERE email = ? AND created_at > ?',
    email,
    now - 24 * 3600 * 1000,
  )
  if (recent?.last && now - recent.last < CODE_COOLDOWN_MS) {
    return { ok: false, error: '发送过于频繁，请稍后再试', retryAfter: Math.ceil((CODE_COOLDOWN_MS - (now - recent.last)) / 1000) }
  }
  if ((recent?.n ?? 0) >= CODE_DAILY_LIMIT) {
    return { ok: false, error: '该邮箱今日验证码次数已达上限' }
  }
  const code = randomDigits(6)
  // 同一用途只保留最新一条有效验证码；旧记录保留用于计数，但令其过期
  await p.db.run('UPDATE email_codes SET expires_at = 0 WHERE email = ? AND purpose = ?', email, purpose)
  await p.db.run(
    'INSERT INTO email_codes (id, email, purpose, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    newId(),
    email,
    purpose,
    await codeHash(p, email, purpose, code),
    now + CODE_TTL_MS,
    now,
  )
  return { ok: true, code }
}

/** 校验并作废验证码（注册 / 重置密码的最终提交） */
export function consumeEmailCode(p: Platform, email: string, purpose: CodePurpose, code: string) {
  return checkEmailCode(p, email, purpose, code, true)
}

/**
 * 校验验证码，返回错误信息或 null。consume=false 时只校验不作废（分步表单的中间步骤），
 * 错误尝试同样计入次数上限，因此不会放宽暴力猜测的限制。
 */
export async function checkEmailCode(
  p: Platform,
  email: string,
  purpose: CodePurpose,
  code: string,
  consume = false,
): Promise<string | null> {
  const row = await p.db.get<{ id: string; code_hash: string; attempts: number; expires_at: number }>(
    'SELECT id, code_hash, attempts, expires_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
    email,
    purpose,
  )
  if (!row || row.expires_at < Date.now()) return '验证码无效或已过期'
  if (row.attempts >= CODE_MAX_ATTEMPTS) return '尝试次数过多，请重新获取验证码'
  const ok = typeof code === 'string' && timingSafeEqual(await codeHash(p, email, purpose, code.trim()), row.code_hash)
  if (!ok) {
    await p.db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id)
    return '验证码错误'
  }
  if (consume) await p.db.run('UPDATE email_codes SET expires_at = 0 WHERE id = ?', row.id)
  return null
}

export function codeMail(p: Platform, code: string, purpose: CodePurpose) {
  const action = purpose === 'register' ? '注册' : '重置密码'
  const subject = `【${p.config.appName}】${action}验证码：${code}`
  const text = `你的${action}验证码是 ${code}，10 分钟内有效。\n如果这不是你本人的操作，请忽略本邮件。`
  const html = `<p>你的${action}验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#666">10 分钟内有效。如果这不是你本人的操作，请忽略本邮件。</p>`
  return { subject, text, html }
}

/* ---------------- 登录失败计数（渐进式：先要求验证码，再临时锁定） ---------------- */

const FAIL_WINDOW_MS = 15 * 60 * 1000
export const CAPTCHA_AFTER_FAILURES = 3
const LOCK_AFTER_FAILURES = 10
const LOCK_MS = 15 * 60 * 1000

export interface FailureState {
  count: number
  lockedUntil: number | null
}

export async function getFailures(p: Platform, key: string): Promise<FailureState> {
  const row = await p.db.get<{ count: number; window_start: number; locked_until: number | null }>(
    'SELECT count, window_start, locked_until FROM auth_failures WHERE key = ?',
    key,
  )
  const now = Date.now()
  if (!row) return { count: 0, lockedUntil: null }
  if (row.locked_until && row.locked_until > now) return { count: row.count, lockedUntil: row.locked_until }
  if (now - row.window_start > FAIL_WINDOW_MS) return { count: 0, lockedUntil: null }
  return { count: row.count, lockedUntil: null }
}

export async function recordFailure(p: Platform, key: string) {
  const now = Date.now()
  const cur = await getFailures(p, key)
  const count = cur.count + 1
  const lockedUntil = count >= LOCK_AFTER_FAILURES ? now + LOCK_MS : null
  await p.db.run(
    `INSERT INTO auth_failures (key, count, window_start, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count,
       window_start = CASE WHEN ? = 1 THEN excluded.window_start ELSE auth_failures.window_start END,
       locked_until = excluded.locked_until`,
    key,
    count,
    now,
    lockedUntil,
    cur.count === 0 ? 1 : 0,
  )
}

export async function clearFailures(p: Platform, key: string) {
  await p.db.run('DELETE FROM auth_failures WHERE key = ?', key)
}
