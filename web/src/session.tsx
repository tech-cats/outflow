import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type AppConfig, type User } from './api'

interface Session {
  user: User | null
  config: AppConfig | null
  loading: boolean
  /** 修改了当前用户的资料（如头像）后更新会话 */
  setUser(u: User): void
}

const Ctx = createContext<Session>({ user: null, config: null, loading: true, setUser: () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Omit<Session, 'setUser'>>({ user: null, config: null, loading: true })
  useEffect(() => {
    Promise.all([api<{ user: User | null }>('/me'), api<AppConfig>('/config')])
      .then(([me, config]) => {
        setS({ user: me.user, config, loading: false })
        document.title = config.appName
        if (config.appIcon) document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', config.appIcon)
      })
      .catch(() => setS((x) => ({ ...x, loading: false })))
  }, [])
  return <Ctx.Provider value={{ ...s, setUser: (user) => setS((x) => ({ ...x, user })) }}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)
