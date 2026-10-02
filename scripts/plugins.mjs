#!/usr/bin/env node
/**
 * 扫描 plugins/<dir>/outflow.plugin.json，生成插件注册表：
 *   server/src/plugins.gen.ts   服务端（静态 import，Workers 不支持运行时加载代码）
 *   web/src/plugins.gen.ts      前端
 *   web/plugins.gen.json        给 Vite 用的插件目录与静态资源目录
 * 生成的文件不提交；install / dev / build / typecheck 前会自动执行。
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'plugins')
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

const fail = (msg) => {
  console.error(`[plugins] ${msg}`)
  process.exit(1)
}

const found = []
if (existsSync(pluginsDir)) {
  for (const name of readdirSync(pluginsDir).sort()) {
    const dir = join(pluginsDir, name)
    const manifestPath = join(dir, 'outflow.plugin.json')
    if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue
    let m
    try {
      m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (e) {
      fail(`${name}/outflow.plugin.json 不是合法的 JSON：${e.message}`)
    }
    if (!ID_RE.test(m.id ?? '')) fail(`${name}：id 只能包含小写字母、数字和连字符`)
    if (typeof m.name !== 'string' || !m.name) fail(`${name}：缺少 name`)
    if (found.some((x) => x.manifest.id === m.id)) fail(`插件 id 重复：${m.id}`)
    // 插件源码按 ES 模块加载；没有 "type": "module" 时 Node 会把 .ts 当作 CommonJS，导致默认导出取不到
    const pkgPath = join(dir, 'package.json')
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null
    if (pkg?.type !== 'module') fail(`${name}：插件目录需要一个包含 "type": "module" 的 package.json`)
    if (pkg.dependencies && Object.keys(pkg.dependencies).length) fail(`${name}：插件不能有自己的 npm 依赖（dependencies）`)
    for (const key of ['server', 'web', 'public']) {
      if (m[key] !== undefined && !existsSync(join(dir, m[key]))) fail(`${name}：${key} 指向的路径不存在（${m[key]}）`)
    }
    for (const n of m.nav ?? []) {
      if (typeof n.label !== 'string' || typeof n.href !== 'string' || !n.href.startsWith('/')) fail(`${name}：nav 格式错误`)
    }
    found.push({ name, dir, manifest: m })
  }
}

const importPath = (fromDir, file) => {
  let p = relative(fromDir, file).replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '')
  return p.startsWith('.') ? p : './' + p
}
const manifestOnly = ({ id, name, description, nav }) => ({ id, name, description, nav })
const header = '// 由 scripts/plugins.mjs 生成，请勿手动修改，也不要提交\n'

{
  const out = join(root, 'server/src')
  const lines = [header, "import type { LoadedPlugin } from './plugins/host'"]
  found.forEach((x, i) => x.manifest.server && lines.push(`import s${i} from '${importPath(out, join(x.dir, x.manifest.server))}'`))
  lines.push('', 'export const plugins: LoadedPlugin[] = [')
  found.forEach((x, i) =>
    lines.push(`  { manifest: ${JSON.stringify(manifestOnly(x.manifest))}${x.manifest.server ? `, server: s${i}` : ''} },`),
  )
  lines.push(']', '')
  writeFileSync(join(out, 'plugins.gen.ts'), lines.join('\n'))
}

{
  const out = join(root, 'web/src')
  const lines = [header, "import type { LoadedWebPlugin } from './plugins'"]
  found.forEach((x, i) => x.manifest.web && lines.push(`import w${i} from '${importPath(out, join(x.dir, x.manifest.web))}'`))
  lines.push('', 'export const plugins: LoadedWebPlugin[] = [')
  found.forEach((x, i) =>
    lines.push(`  { manifest: ${JSON.stringify(manifestOnly(x.manifest))}${x.manifest.web ? `, web: w${i}` : ''} },`),
  )
  lines.push(']', '')
  writeFileSync(join(out, 'plugins.gen.ts'), lines.join('\n'))
}

writeFileSync(
  join(root, 'web/plugins.gen.json'),
  JSON.stringify(
    found.map((x) => ({
      id: x.manifest.id,
      // 插件目录可能是软链接；Vite 的文件访问白名单需要真实路径
      dir: realpathSync(x.dir),
      public: x.manifest.public ? realpathSync(join(x.dir, x.manifest.public)) : null,
    })),
    null,
    2,
  ) + '\n',
)

console.log(found.length ? `[plugins] ${found.map((x) => x.manifest.id).join(', ')}` : '[plugins] 未安装插件')
