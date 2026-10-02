/**
 * 评论正文是纯文本，只识别两种标记：
 *  <@userId>  —— 提及（存 id 而不是名字，改名后仍然正确）
 *  http(s)://… —— 自动链接
 * 服务端（阅读页、通知）与前端共用。
 */

export type CommentToken = { t: 'text'; v: string } | { t: 'mention'; id: string } | { t: 'link'; v: string }

const TOKEN_RE = /<@([0-9a-z]{12})>|https?:\/\/[^\s<>"'，。；！？、）]+/g

export function tokenize(body: string): CommentToken[] {
  const out: CommentToken[] = []
  let last = 0
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push({ t: 'text', v: body.slice(last, m.index) })
    out.push(m[1] ? { t: 'mention', id: m[1] } : { t: 'link', v: m[0] })
    last = m.index + m[0].length
  }
  if (last < body.length) out.push({ t: 'text', v: body.slice(last) })
  return out
}

export function mentionedIds(body: string): string[] {
  return [...new Set(tokenize(body).flatMap((x) => (x.t === 'mention' ? [x.id] : [])))]
}

/** 转为纯文本（用于通知摘要、邮件） */
export function plainText(body: string, names: Record<string, string>): string {
  return tokenize(body)
    .map((x) => (x.t === 'mention' ? `@${names[x.id] ?? '未知用户'}` : x.v))
    .join('')
}
