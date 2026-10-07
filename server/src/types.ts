import type { SiteInfo } from './core/site'
import type { Config } from './config'

/** 极简 SQL 接口：D1 与 better-sqlite3 各实现一份 */
export interface DB {
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>
}

export interface Storage {
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string } | null>
  delete(key: string): Promise<void>
}

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>
}

export type RateBucket = 'auth' | 'write' | 'read'

export interface RateLimiter {
  /** 返回 true 表示放行 */
  limit(bucket: RateBucket, key: string): Promise<boolean>
}

/** 仅用于匿名访问的公开页面缓存 */
export interface PageCache {
  match(key: string): Promise<Response | null>
  put(key: string, res: Response, ttlSeconds: number): Promise<void>
  purge(keys: string[]): Promise<void>
}

export interface Collab {
  /** 用 ProseMirror JSON 整体替换文档内容（回滚版本时用） */
  replace(docId: string, json: PMNode, editorId: string): Promise<void>
  /** CF 上转发到 Durable Object；Node 端的升级在 HTTP server 层处理，此处不会被调用 */
  upgrade?(req: Request, docId: string, conn: { readonly: boolean; userId: string }): Promise<Response>
}

export interface Platform {
  config: Config
  db: DB
  storage: Storage
  mailer: Mailer
  rateLimit: RateLimiter
  cache: PageCache
  collab: Collab
  /** 在响应返回后继续执行的后台任务 */
  waitUntil(p: Promise<unknown>): void
  /** 获取客户端 IP；rawEnv 为 Hono 的 c.env（Node 下包含底层 socket） */
  clientIp(req: Request, rawEnv: unknown): string
  /** 客户端国家/地区代码（ISO 3166-1 alpha-2，大写），无法识别时为 null */
  clientCountry(req: Request, rawEnv: unknown): string | null
}

export type Role = 'member' | 'contributor' | 'editor' | 'admin'
export type Visibility = 'public' | 'protected' | 'draft'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  /** 头像地址（/uploads/...）；没有时显示用户名首字 */
  avatar?: string | null
}

export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

export type AppEnv = {
  Variables: {
    p: Platform
    user: User | null
    /** 站点信息，按需加载（见 routes/util.ts 的 siteInfo） */
    site?: SiteInfo
  }
}
