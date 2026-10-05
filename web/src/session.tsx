import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type AppConfig, type User } from './api'

interface Session {
  user: User | null
  config: AppConfig | null
  loading: boolean
}

const Ctx = createContext<Session>({ user: null, config: null, loading: true })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Session>({ user: null, config: null, loading: true })
  useEffect(() => {
    Promise.all([api<{ user: User | null }>('/me'), api<AppConfig>('/config')])
      .then(([me, config]) => {
        setS({ user: me.user, config, loading: false })
        document.title = config.appName
        if (config.appIcon) document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', config.appIcon)
      })
      .catch(() => setS((x) => ({ ...x, loading: false })))
  }, [])
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)
