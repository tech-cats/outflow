import { cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时：Vite 提供 SPA，其余动态路由代理到 Node 服务（pnpm dev 同时启动两者）
const target = process.env.API_URL ?? 'http://localhost:8787'

// Outflow 插件（由 scripts/plugins.mjs 生成）
const genPath = resolve(import.meta.dirname, 'plugins.gen.json')
const outflowPlugins: { id: string; dir: string; public: string | null }[] = existsSync(genPath)
  ? JSON.parse(readFileSync(genPath, 'utf8'))
  : []

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** 插件静态资源：开发时直接提供，构建时复制到 dist/plugins/<id>/ */
function pluginAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'outflow-plugin-assets',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir)
    },
    configureServer(server) {
      // 插件列表在启动时读取；增删插件后重新生成 plugins.gen.json 会触发重启，否则新插件的资源和 fs.allow 都不会生效
      server.watcher.add(genPath)
      const onGen = (f: string) => f === genPath && void server.restart()
      server.watcher.on('add', onGen).on('change', onGen)
      server.middlewares.use((req, res, next) => {
        const m = /^\/plugins\/([a-z0-9-]+)\/(.+)$/.exec(decodeURIComponent((req.url ?? '').split('?')[0]))
        const p = m && outflowPlugins.find((x) => x.id === m[1])
        if (!p?.public) return next()
        const file = resolve(p.public, m![2])
        if (!file.startsWith(p.public + '/') || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    closeBundle() {
      for (const p of outflowPlugins) {
        if (p.public) cpSync(p.public, join(outDir, 'plugins', p.id), { recursive: true, dereference: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), pluginAssets()],
  resolve: {
    alias: { '@outflow/sdk/web': resolve(import.meta.dirname, 'src/sdk.ts') },
    // 插件可能在仓库外，确保它们和宿主共用同一份 React
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...outflowPlugins.map((p) => p.dir)] },
    proxy: {
      '/api': { target, ws: true },
      '^/(c|d|uploads)(/|$|\\?)': { target },
      '^/(search|sitemap\\.xml|robots\\.txt)?(\\?.*)?$': { target },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
