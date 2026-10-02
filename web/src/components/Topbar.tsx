import { api, hasRole } from '../api'
import { useSession } from '../session'
import { toggleTheme } from '../theme'

/** 与服务端阅读页保持一致的顶栏；跳到阅读页一律用整页导航 */
export function Topbar({ children }: { children?: React.ReactNode }) {
  const { user, config } = useSession()
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
        {user ? (
          <>
            {hasRole(user, 'contributor') && (
              <a className="btn btn-primary btn-sm" href="/new">
                写文档
              </a>
            )}
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

