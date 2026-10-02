import { mentionedIds, plainText } from '../lib/comment-text'
import { escapeHtml } from '../lib/prosemirror'
import { newId } from '../lib/crypto'
import type { Platform, Role, User } from '../types'
import { chainReadable, loadChain } from './access'

/**
 * 通知模块。业务代码只上报事件，收件人计算、权限过滤、站内信写入与邮件发送都在这里完成。
 *
 * 规则（同一事件对同一个人只发一条，按优先级取最高的一种）：
 *  mention —— 评论里 @ 了你
 *  reply   —— 你发起或参与过的讨论有了新回复
 *  comment —— 你创建的文档有了新批注 / 讨论
 *  resolve —— 你发起的批注被别人解决
 * 不通知操作者本人、已停用用户，以及（如今）读不到这篇文档的人。
 */

export type NotifyType = 'mention' | 'reply' | 'comment' | 'resolve'

export type NotifyEvent =
  | { type: 'comment.created'; actor: User; docId: string; commentId: string }
  | { type: 'comment.resolved'; actor: User; docId: string; commentId: string }

const PRIORITY: NotifyType[] = ['mention', 'reply', 'comment', 'resolve']
/** 同一文档短时间内已有未读通知时不再发邮件，避免刷屏 */
const EMAIL_QUIET_MS = 10 * 60 * 1000
const MAX_MENTIONS = 20

interface CommentRow {
  id: string
  doc_id: string
  parent_id: string | null
  author_id: string
  body: string
  anchor: string | null
}

/** 通知点击后的落点：行内批注打开批注面板，文末讨论跳到阅读页对应位置 */
export function commentLink(docId: string, root: { id: string; anchor: string | null }): string {
  return root.anchor ? `/edit/${docId}?comments=1&note=${root.id}` : `/d/${docId}#c-${root.id}`
}

export async function notify(p: Platform, event: NotifyEvent, baseUrl: string): Promise<void> {
  const db = p.db
  const comment = await db.get<CommentRow>('SELECT id, doc_id, parent_id, author_id, body, anchor FROM comments WHERE id = ?', event.commentId)
  if (!comment) return
  const root = comment.parent_id
    ? await db.get<CommentRow>('SELECT id, doc_id, parent_id, author_id, body, anchor FROM comments WHERE id = ?', comment.parent_id)
    : comment
  const doc = await db.get<{ title: string; author_id: string }>('SELECT title, author_id FROM docs WHERE id = ?', event.docId)
  if (!root || !doc) return

  // 计算收件人
  const targets = new Map<string, NotifyType>()
  const add = (userId: string, type: NotifyType) => {
    const cur = targets.get(userId)
    if (!cur || PRIORITY.indexOf(type) < PRIORITY.indexOf(cur)) targets.set(userId, type)
  }
  if (event.type === 'comment.created') {
    for (const id of mentionedIds(comment.body).slice(0, MAX_MENTIONS)) add(id, 'mention')
    if (comment.parent_id) {
      add(root.author_id, 'reply')
      const others = await db.all<{ author_id: string }>('SELECT DISTINCT author_id FROM comments WHERE parent_id = ?', root.id)
      for (const o of others) add(o.author_id, 'reply')
    } else {
      add(doc.author_id, 'comment')
    }
  } else {
    add(root.author_id, 'resolve')
  }
  targets.delete(event.actor.id)
  if (!targets.size) return

  // 过滤：存在、未停用、能读到文档
  const ids = [...targets.keys()]
  const users = await db.all<{ id: string; email: string; name: string; role: Role; disabled: number; notify_email: number }>(
    `SELECT id, email, name, role, disabled, notify_email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  )
  const chain = await loadChain(db, event.docId)
  const recipients = users.filter((u) => !u.disabled && chainReadable(u, chain))
  if (!recipients.length) return

  const names = await mentionNames(p, [comment.body])
  const excerpt = plainText(comment.body, names).replace(/\s+/g, ' ').slice(0, 140)
  const link = commentLink(event.docId, root)
  const now = Date.now()

  const mailTo: { user: (typeof recipients)[number]; type: NotifyType }[] = []
  for (const u of recipients) {
    const type = targets.get(u.id)!
    if (p.config.mail.driver !== 'none' && u.notify_email) {
      const recent = await db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND doc_id = ? AND read_at IS NULL AND created_at > ?',
        u.id,
        event.docId,
        now - EMAIL_QUIET_MS,
      )
      if (!recent?.n) mailTo.push({ user: u, type })
    }
    await db.run(
      `INSERT INTO notifications (id, user_id, type, actor_id, doc_id, comment_id, excerpt, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      u.id,
      type,
      event.actor.id,
      event.docId,
      comment.id,
      excerpt,
      link,
      now,
    )
  }

  // 邮件在响应返回后发送，失败只记录日志
  if (mailTo.length) {
    const title = doc.title || '无标题'
    p.waitUntil(
      Promise.all(
        mailTo.map(({ user, type }) =>
          p.mailer
            .send({ to: user.email, ...notifyMail(p.config.appName, event.actor.name, type, title, excerpt, baseUrl + link) })
            .catch((err) => console.error('notify mail failed', user.id, err)),
        ),
      ),
    )
  }
}

export const NOTIFY_TEXT: Record<NotifyType, string> = {
  mention: '提到了你',
  reply: '回复了讨论',
  comment: '评论了你的文档',
  resolve: '解决了你的批注',
}

function notifyMail(appName: string, actor: string, type: NotifyType, title: string, excerpt: string, url: string) {
  const subject = `【${appName}】${actor} ${NOTIFY_TEXT[type]}：${title}`
  const text = `${actor} 在「${title}」${NOTIFY_TEXT[type]}${excerpt ? `：\n\n${excerpt}` : ''}\n\n查看：${url}\n\n不想再收到邮件？可以在网站的通知页面关闭邮件提醒。`
  const html =
    `<p>${escapeHtml(actor)} 在「${escapeHtml(title)}」${NOTIFY_TEXT[type]}</p>` +
    (excerpt ? `<blockquote style="margin:12px 0;padding:4px 12px;border-left:3px solid #ddd;color:#555">${escapeHtml(excerpt)}</blockquote>` : '') +
    `<p><a href="${escapeHtml(url)}">查看</a></p><p style="color:#999;font-size:12px">不想再收到邮件？可以在网站的通知页面关闭邮件提醒。</p>`
  return { subject, text, html }
}

/** 评论正文中被提及用户的名字 */
export async function mentionNames(p: Platform, bodies: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(bodies.flatMap(mentionedIds))].slice(0, 500)
  if (!ids.length) return {}
  const rows = await p.db.all<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  )
  return Object.fromEntries(rows.map((r) => [r.id, r.name]))
}
