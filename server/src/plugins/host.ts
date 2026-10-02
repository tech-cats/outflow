import { Hono } from 'hono'
import { canEditChain, chainReadable, hasRole, loadChain } from '../core/access'
import { docCacheKeys } from '../core/docs'
import { escapeHtml } from '../lib/prosemirror'
import { plugins } from '../plugins.gen'
import { fail, requireRole, requireUser } from '../routes/util'
import type { AppEnv } from '../types'
import type { PluginContext, PluginHost, PluginManifest, PluginRequest, PluginStore, ServerPlugin } from './sdk'

export interface LoadedPlugin {
  manifest: PluginManifest
  server?: ServerPlugin
}

export const loadedPlugins: LoadedPlugin[] = plugins

/** 所有插件声明的顶栏入口 */
export const pluginNav = loadedPlugins.flatMap((x) => x.manifest.nav ?? [])

const MAX_VALUE_BYTES = 256 * 1024

function makeRequest(c: PluginContext, pluginId: string): PluginRequest {
  const p = c.var.p
  const user = c.var.user
  return {
    user,
    hasRole: (role) => hasRole(user, role),
    store<T>(kind: string): PluginStore<T> {
      return {
        async get(key) {
          const row = await p.db.get<{ value: string }>(
            'SELECT value FROM plugin_data WHERE plugin = ? AND kind = ? AND key = ?',
            pluginId,
            kind,
            key,
          )
          return row ? (JSON.parse(row.value) as T) : null
        },
        async list() {
          const rows = await p.db.all<{ key: string; value: string; updated_at: number }>(
            'SELECT key, value, updated_at FROM plugin_data WHERE plugin = ? AND kind = ? ORDER BY key LIMIT 5000',
            pluginId,
            kind,
          )
          return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as T, updatedAt: r.updated_at }))
        },
        async put(key, value) {
          const json = JSON.stringify(value)
          if (json.length > MAX_VALUE_BYTES) throw new Error('plugin value too large')
          await p.db.run(
            `INSERT INTO plugin_data (plugin, kind, key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (plugin, kind, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
            pluginId,
            kind,
            key,
            json,
            Date.now(),
            user?.id ?? null,
          )
        },
        async delete(key) {
          await p.db.run('DELETE FROM plugin_data WHERE plugin = ? AND kind = ? AND key = ?', pluginId, kind, key)
        },
      }
    },
    docs: {
      async access(docId) {
        const doc = await p.db.get<{ id: string; title: string }>('SELECT id, title FROM docs WHERE id = ?', docId)
        if (!doc) return null
        const chain = await loadChain(p.db, docId)
        const readable = chainReadable(user, chain)
        return { id: doc.id, title: readable ? doc.title : '', readable, editable: readable && canEditChain(user, chain) }
      },
      async readable(docIds) {
        const out: { id: string; title: string }[] = []
        for (const id of [...new Set(docIds)].slice(0, 200)) {
          const a = await this.access(id)
          if (a?.readable) out.push({ id: a.id, title: a.title })
        }
        return out
      },
    },
    purgeDocPage: (docId) => p.cache.purge(docCacheKeys(docId)),
    escape: escapeHtml,
  }
}

/** 把插件 API 挂到 /api/plugins/<id> */
export function mountPlugins(app: Hono<AppEnv>) {
  for (const { manifest, server } of loadedPlugins) {
    if (!server?.api) continue
    const sub = new Hono<AppEnv>()
    const host: PluginHost = {
      get: (c) => makeRequest(c, manifest.id),
      requireRole,
      requireUser,
    }
    server.api(sub, host)
    sub.onError((err, c) => {
      console.error(`[plugin:${manifest.id}]`, err)
      return fail(c, 500, '插件出错了')
    })
    app.route(`/api/plugins/${manifest.id}`, sub)
  }
}

/** 文档阅读页中各插件的 HTML 片段；单个插件出错不影响页面 */
export async function renderDocSections(c: PluginContext, doc: { id: string; title: string }): Promise<string> {
  const parts: string[] = []
  for (const { manifest, server } of loadedPlugins) {
    if (!server?.docSection) continue
    try {
      const html = await server.docSection(makeRequest(c, manifest.id), doc)
      if (html) parts.push(`<section class="plugin-section" data-plugin="${escapeHtml(manifest.id)}">${html}</section>`)
    } catch (err) {
      console.error(`[plugin:${manifest.id}] docSection`, err)
    }
  }
  return parts.join('')
}
