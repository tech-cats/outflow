export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(message)
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers: {} }
  if (opts.body instanceof FormData) {
    init.body = opts.body
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  const res = await fetch('/api' + path, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? `请求失败（${res.status}）`, res.status, data)
  return data as T
}

export type Role = 'member' | 'contributor' | 'editor' | 'admin'
export const ROLES: Role[] = ['member', 'contributor', 'editor', 'admin']
export const ROLE_LABEL: Record<Role, string> = { member: '成员', contributor: '贡献者', editor: '编辑', admin: '管理员' }

/** 角色逐级包含，与 server/src/core/access.ts 保持一致 */
export function hasRole(user: User | null | undefined, role: Role): boolean {
  return !!user && ROLES.indexOf(user.role) >= ROLES.indexOf(role)
}
export type GeoScope = 'register' | 'login'
export type Visibility = 'public' | 'protected' | 'draft'

export interface User {
  id: string
  email: string
  name: string
  role: Role
}

export interface AppConfig {
  appName: string
  registrationEnabled: boolean
  loginCaptcha: 'always' | 'after_failures'
  geo: { country: string | null; blocked: GeoScope[] }
  mail: { configured: boolean; devConsole: boolean }
  captcha: { provider: 'altcha' | 'turnstile' | 'hcaptcha' | 'none'; siteKey: string }
}

export interface Collection {
  id: string
  name: string
  description: string
  defaultVisibility: Visibility
}

export interface DocMeta {
  id: string
  collectionId: string
  parentId: string | null
  title: string
  visibility: Visibility
  locked: boolean
  authorId: string
  sort: number
  updatedAt: number
}

export const VIS_LABEL: Record<Visibility, string> = { public: '公开', protected: '仅登录可见', draft: '草稿' }
export const VIS_HINT: Record<Visibility, string> = {
  public: '任何人（包括未登录访客和搜索引擎）都可以阅读',
  protected: '仅登录用户可以阅读',
  draft: '仅作者和管理员可见',
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export async function createDoc(collectionId: string, parentId: string | null): Promise<string> {
  const { id } = await api<{ id: string }>('/docs', { body: { collectionId, parentId } })
  return id
}
