import { escapeHtml } from '../lib/prosemirror'
import type { Platform } from '../types'

/**
 * 验证码邮件模板（按站点配置，保存在 settings 表；未设置时使用默认模板）。
 * 占位符：{app} 站点名、{action} 注册 / 重置密码、{code} 验证码、{url} 站点地址。
 * 正文是纯文本：每行一个段落，单独一行的 {code} 在 HTML 邮件中以大号字显示。
 */
export interface MailTemplate {
  subject: string
  body: string
}

export const DEFAULT_MAIL_TEMPLATE: MailTemplate = {
  subject: '【{app}】{action}验证码：{code}',
  body: '你的{action}验证码是：\n{code}\n10 分钟内有效。如果这不是你本人的操作，请忽略本邮件。',
}

export const MAIL_PLACEHOLDERS = { app: '站点名', action: '注册 / 重置密码', code: '验证码', url: '站点地址' } as const
type Vars = Record<keyof typeof MAIL_PLACEHOLDERS, string>

const KEY = { subject: 'mail.subject', body: 'mail.body' }
export const MAIL_LIMITS = { subject: 200, body: 2000 }

export async function getMailTemplate(p: Platform): Promise<MailTemplate & { custom: boolean }> {
  const rows = await p.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'mail.%'")
  const m = new Map(rows.map((r) => [r.key, r.value]))
  const subject = m.get(KEY.subject)
  const body = m.get(KEY.body)
  return { subject: subject ?? DEFAULT_MAIL_TEMPLATE.subject, body: body ?? DEFAULT_MAIL_TEMPLATE.body, custom: subject !== undefined || body !== undefined }
}

/** 校验模板，返回错误信息；正文必须包含 {code}，否则用户收不到验证码 */
export function checkMailTemplate(t: MailTemplate): string | null {
  if (!t.subject.trim() || !t.body.trim()) return '标题和正文不能为空'
  if (t.subject.length > MAIL_LIMITS.subject || t.body.length > MAIL_LIMITS.body) return `标题最多 ${MAIL_LIMITS.subject} 字，正文最多 ${MAIL_LIMITS.body} 字`
  if (!t.body.includes('{code}')) return '正文必须包含 {code}'
  return null
}

/** t 为 null 时恢复默认模板 */
export async function setMailTemplate(p: Platform, t: MailTemplate | null) {
  await p.db.run("DELETE FROM settings WHERE key LIKE 'mail.%'")
  if (!t) return
  const now = Date.now()
  for (const [k, v] of [
    [KEY.subject, t.subject],
    [KEY.body, t.body],
  ]) {
    await p.db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', k, v, now)
  }
}

const fill = (s: string, vars: Vars, map: (k: keyof Vars, v: string) => string = (_, v) => v) =>
  s.replace(/\{(app|action|code|url)\}/g, (_, k: keyof Vars) => map(k, vars[k]))

export function renderMail(t: MailTemplate, vars: Vars) {
  // 标题不能含换行（防止邮件头注入）
  const subject = fill(t.subject, vars).replace(/[\r\n]+/g, ' ').trim()
  const text = fill(t.body, vars)
  const html = t.body
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      if (line.trim() === '{code}') return `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(vars.code)}</p>`
      const inner = fill(escapeHtml(line), vars, (k, v) =>
        k === 'url' ? `<a href="${escapeHtml(v)}">${escapeHtml(v)}</a>` : k === 'code' ? `<strong>${escapeHtml(v)}</strong>` : escapeHtml(v),
      )
      return `<p>${inner}</p>`
    })
    .join('')
  return { subject, text, html }
}
