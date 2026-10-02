import type { ComponentType } from 'react'
import type { User } from './api'
import { plugins } from './plugins.gen'

export interface WebPluginManifest {
  id: string
  name: string
  description?: string
  nav?: { label: string; href: string }[]
}

export interface DocPanelProps {
  docId: string
  /** 当前用户能否编辑这篇文档 */
  canEdit: boolean
  user: User
}

export interface WebPlugin {
  /** 前端页面；fullscreen 的页面不显示站点页脚，适合地图这类占满视口的页面 */
  pages?: { path: string; component: ComponentType; fullscreen?: boolean }[]
  /** 编辑页中正文与讨论之间的区域 */
  docPanel?: ComponentType<DocPanelProps>
}

export interface LoadedWebPlugin {
  manifest: WebPluginManifest
  web?: WebPlugin
}

export const loadedPlugins = plugins
export const pluginNav = plugins.flatMap((x) => x.manifest.nav ?? [])
export const pluginPages = plugins.flatMap((x) => x.web?.pages ?? [])
export const docPanels = plugins.flatMap((x) => (x.web?.docPanel ? [{ id: x.manifest.id, Panel: x.web.docPanel }] : []))
