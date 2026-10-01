const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const e = email.trim().toLowerCase()
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null
}

/** 校验并规范化一条白名单规则，非法返回 null */
export function normalizeRule(rule: unknown): string | null {
  if (typeof rule !== 'string') return null
  const r = rule.trim().toLowerCase()
  if (/^\*\.[a-z0-9.-]+\.[a-z]{2,}$/.test(r)) return r
  if (/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(r)) return r
  if (EMAIL_RE.test(r)) return r
  return null
}

/**
 * 规则：
 *  - `*.edu.cn`      匹配 edu.cn 的任意子域（pku.edu.cn、mail.tsinghua.edu.cn）
 *  - `@pku.edu.cn`   精确匹配域名
 *  - `a@gmail.com`   精确匹配单个邮箱
 * 没有任何规则命中即拒绝。
 */
export function isEmailAllowed(email: string, rules: string[]): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1)
  return rules.some((rule) => {
    if (rule.startsWith('*.')) return domain.endsWith(rule.slice(1))
    if (rule.startsWith('@')) return domain === rule.slice(1)
    return email === rule
  })
}
