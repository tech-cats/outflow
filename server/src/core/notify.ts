import { mentionedIds, plainText } from '../lib/comment-text'
import { newId } from '../lib/crypto'
import type { Platform, Role, User } from '../types'
import { chainReadable, loadChain } from './access'

/**
 * 通知模块（仅站内通知，不发邮件）。业务代码只上报事件，收件人计算、权限过滤与写入都在这里完成。
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

export async function notify(p: Platform, event: NotifyEvent): Promise<void> {
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
  const users = await db.all<{ id: string; email: string; name: string; role: Role; disabled: number }>(
    `SELECT id, email, name, role, disabled FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  )
  const chain = await loadChain(db, event.docId)
  const recipients = users.filter((u) => !u.disabled && chainReadable(u, chain))
  if (!recipients.length) return

  const names = await mentionNames(p, [comment.body])
  const excerpt = plainText(comment.body, names).replace(/\s+/g, ' ').slice(0, 140)
  const link = commentLink(event.docId, root)
  const now = Date.now()

  for (const u of recipients) {
    await db.run(
      `INSERT INTO notifications (id, user_id, type, actor_id, doc_id, comment_id, excerpt, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      u.id,
      targets.get(u.id)!,
      event.actor.id,
      event.docId,
      comment.id,
      excerpt,
      link,
      now,
    )
  }
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
