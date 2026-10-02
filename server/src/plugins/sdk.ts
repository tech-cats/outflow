/**
 * 服务端插件 SDK（插件中以 `@outflow/sdk/server` 引入）。
 *
 * 这里只有类型：插件的服务端代码必须用 `import type` 引入，不能有任何运行时依赖。
 * 运行时能力（权限、存储、文档访问）由宿主通过参数传给插件，这样插件在 Node 与
 * Cloudflare Workers 上都无需额外打包配置。
 */
import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { AppEnv, Role, User } from '../types'

export type { Role, User }
export type PluginEnv = AppEnv
export type PluginContext = Context<PluginEnv>

/** 插件清单（outflow.plugin.json） */
export interface PluginManifest {
  /** 小写字母、数字和连字符；决定 API 前缀 /api/plugins/<id> 与静态资源前缀 /plugins/<id> */
  id: string
  name: string
  description?: string
  /** 顶栏入口 */
  nav?: { label: string; href: string }[]
  /** 服务端入口（相对插件目录），默认导出 ServerPlugin */
  server?: string
  /** 前端入口（相对插件目录），默认导出 WebPlugin */
  web?: string
  /** 静态资源目录（相对插件目录），对外路径为 /plugins/<id>/... */
  public?: string
}

/** 插件私有的键值存储，值为任意可 JSON 序列化的数据 */
export interface PluginStore<T> {
  get(key: string): Promise<T | null>
  list(): Promise<{ key: string; value: T; updatedAt: number }[]>
  put(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

export interface DocAccess {
  id: string
  title: string
  readable: boolean
  editable: boolean
}

/** 当前请求的宿主能力 */
export interface PluginRequest {
  user: User | null
  hasRole(role: Role): boolean
  store<T>(kind: string): PluginStore<T>
  docs: {
    /** 当前用户对文档的权限；文档不存在时返回 null */
    access(docId: string): Promise<DocAccess | null>
    /** 过滤出当前用户可读的文档，保持输入顺序 */
    readable(docIds: string[]): Promise<{ id: string; title: string }[]>
  }
  /** 插件改变了某篇文档阅读页上展示的内容时调用，清除该页的匿名缓存 */
  purgeDocPage(docId: string): Promise<void>
  /** HTML 转义，用于 docSection 返回的片段 */
  escape(s: string): string
}

export interface PluginHost {
  /** 取得当前请求的宿主能力 */
  get(c: PluginContext): PluginRequest
  /** 要求登录且角色不低于 role */
  requireRole(role: Role): MiddlewareHandler<PluginEnv>
  /** 要求登录 */
  requireUser: MiddlewareHandler<PluginEnv>
}

export interface ServerPlugin {
  /** 注册 API，app 挂载在 /api/plugins/<id> */
  api?(app: Hono<PluginEnv>, host: PluginHost): void
  /**
   * 文档阅读页（服务端渲染）中、正文与讨论之间的 HTML 片段。
   * 匿名访问的页面会被缓存，因此返回内容不能依赖当前用户；内容变化时调用 purgeDocPage。
   */
  docSection?(req: PluginRequest, doc: { id: string; title: string }): Promise<string | null>
}
