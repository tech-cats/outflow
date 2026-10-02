/**
 * 前端插件 SDK（插件中以 `@outflow/sdk/web` 引入）。
 * 插件不能有自己的 npm 依赖：只能使用宿主提供的 React 与这里导出的能力。
 */
import { api } from './api'

export { ApiError, ROLES, ROLE_LABEL, api, formatTime, hasRole } from './api'
export type { Role, User } from './api'
export { Topbar } from './components/Topbar'
export { useSession } from './session'
export type { DocPanelProps, WebPlugin, WebPluginManifest } from './plugins'

/** 调用插件自己的 API（挂载在 /api/plugins/<id>） */
export function pluginApi(id: string) {
  return <T = any>(path: string, opts: { method?: string; body?: unknown } = {}) => api<T>(`/plugins/${id}${path}`, opts)
}

/** 上传不属于任何文档的公开图片（编辑及以上），返回图片地址 */
export async function uploadPublicImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const { url } = await api<{ url: string }>('/uploads', { body: fd })
  return url
}
