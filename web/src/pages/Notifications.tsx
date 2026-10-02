import { useEffect, useState } from 'react'
import { api, formatTime } from '../api'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

interface Item {
  id: string
  type: 'mention' | 'reply' | 'comment' | 'resolve'
  actorName: string | null
  docTitle: string | null
  excerpt: string
  link: string
  read: boolean
  createdAt: number
}

interface Data {
  items: Item[]
}

const TEXT: Record<Item['type'], string> = {
  mention: '提到了你',
  reply: '回复了讨论',
  comment: '评论了你的文档',
  resolve: '解决了你的批注',
}

export function NotificationsPage() {
  const { user, loading } = useSession()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    api<Data>('/notifications')
      .then(setData)
      .catch((e) => setError((e as Error).message))

  useEffect(() => {
    if (loading) return
    if (!user) location.href = `/login?next=${encodeURIComponent('/notifications')}`
    else void load()
  }, [loading, user])

  const markRead = async (ids?: string[]) => {
    await api('/notifications/read', { body: ids ? { ids } : {} })
    window.dispatchEvent(new Event('notifications:changed'))
  }

  const open = async (n: Item) => {
    if (!n.read) await markRead([n.id]).catch(() => {})
    location.href = n.link
  }

  const unread = data?.items.filter((n) => !n.read).length ?? 0

  return (
    <>
      <Topbar />
      <main className="container" style={{ maxWidth: 720 }}>
        <div className="row-between">
          <h1 style={{ fontSize: 22 }}>通知</h1>
          {unread > 0 && (
            <button
              className="btn btn-sm"
              onClick={async () => {
                await markRead()
                void load()
              }}
            >
              全部标为已读
            </button>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
        {data?.items.length === 0 && <div className="card empty">暂无通知</div>}
        <ul className="list notify-list">
          {data?.items.map((n) => (
            <li key={n.id} className={n.read ? '' : 'unread'}>
              <button className="notify-item" onClick={() => open(n)}>
                <div>
                  <strong>{n.actorName ?? '已注销用户'}</strong> {TEXT[n.type]} · <span className="notify-doc">{n.docTitle || '无标题'}</span>
                </div>
                {n.excerpt && <div className="muted small notify-excerpt">{n.excerpt}</div>}
                <div className="muted small">{formatTime(n.createdAt)}</div>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
