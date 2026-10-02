import { useEffect, useState } from 'react'
import { api, hasRole } from '../api'
import { pluginNav } from '../plugins'
import { useSession } from '../session'
import { toggleTheme } from '../theme'

/** 与服务端阅读页保持一致的顶栏；跳到阅读页一律用整页导航 */
export function Topbar({ children }: { children?: React.ReactNode }) {
  const { user, config } = useSession()
  const unread = useUnread(!!user)
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <span className="brand-mark" />
        {config?.appName ?? 'Outflow'}
      </a>
      <form className="search" action="/search" method="get">
        <input className="input" type="search" name="q" placeholder="搜索文档…" />
      </form>
      <div className="spacer" />
      {children}
      <nav className="nav">
        <button className="theme-toggle" title="切换深色/浅色" aria-label="切换深色/浅色" onClick={toggleTheme}>
          ◐
        </button>
        {pluginNav.map((n) => (
          <a key={n.href} href={n.href}>
            {n.label}
          </a>
        ))}
        {user ? (
          <>
            {hasRole(user, 'contributor') && (
              <a className="btn btn-primary btn-sm" href="/new">
                写文档
              </a>
            )}
            <a href="/notifications" className="bell" title="通知">
              通知{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
            </a>
            {user.role === 'admin' && <a href="/admin">管理</a>}
            <span className="muted">{user.name}</span>
            <button
              className="link"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' })
                location.href = '/'
              }}
            >
              退出
            </button>
          </>
        ) : (
          <>
            <a href="/login">登录</a>
            <a className="btn btn-sm" href="/register">
              注册
            </a>
          </>
        )}
      </nav>
    </header>
  )
}

/** 未读通知数，每分钟刷新一次；其他组件可以派发 notifications:changed 事件立即刷新 */
function useUnread(enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const load = () => {
      if (document.hidden) return
      api<{ count: number }>('/notifications/unread')
        .then((r) => setCount(r.count))
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 60000)
    window.addEventListener('notifications:changed', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('notifications:changed', load)
    }
  }, [enabled])
  return count
}
