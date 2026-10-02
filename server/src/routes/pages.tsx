import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { canEditChain, chainReadable, effectiveVisibility, hasRole, filterReadable, loadChain, type DocNode } from '../core/access'
import { SESSION_COOKIE } from '../core/auth'
import { listComments } from '../core/comments'
import { mentionNames } from '../core/notify'
import { searchDocs } from '../core/search'
import { escapeHtml, jsonToHtml } from '../lib/prosemirror'
import type { AppEnv, PMNode } from '../types'
import { Discussion } from '../views/comments'
import { Layout, Time, Tree, VisBadge } from '../views/layout'
import { rateLimit } from './util'

const pages = new Hono<AppEnv>()
const PAGE_TTL = 60

interface TreeRow extends DocNode {
  title: string
  collection_id: string
  updated_at: number
}

/**
 * 匿名访问的页面走边缘缓存。带会话 Cookie 的请求不读写缓存，
 * 因此登录用户永远看到实时、带个人权限的内容。
 */
async function cached(c: Context<AppEnv>, key: string, render: () => Promise<{ res: Response; cacheable: boolean }>) {
  const anon = !getCookie(c, SESSION_COOKIE)
  if (anon) {
    const hit = await c.var.p.cache.match(key)
    if (hit) return hit
  }
  const { res, cacheable } = await render()
  if (anon && cacheable && res.status === 200) {
    c.var.p.waitUntil(c.var.p.cache.put(key, res.clone(), PAGE_TTL))
    res.headers.set('Cache-Control', `public, max-age=0, s-maxage=${PAGE_TTL}`)
  } else {
    res.headers.set('Cache-Control', 'private, no-store')
  }
  return res
}

function baseUrl(c: Context<AppEnv>) {
  return c.var.p.config.appUrl || new URL(c.req.url).origin
}

function layoutProps(c: Context<AppEnv>) {
  return { appName: c.var.p.config.appName, user: c.var.user }
}

/* ---------------- 首页 ---------------- */

pages.get('/', rateLimit('read'), (c) =>
  cached(c, '/', async () => {
    const db = c.var.p.db
    const [collections, all] = await Promise.all([
      db.all<{ id: string; name: string; description: string }>('SELECT id, name, description FROM collections ORDER BY sort, created_at'),
      db.all<TreeRow>('SELECT id, parent_id, title, visibility, author_id, collection_id, updated_at FROM docs ORDER BY sort, created_at'),
    ])
    const readable = filterReadable(c.var.user, all)
    const recent = [...readable].sort((a, b) => b.updated_at - a.updated_at).slice(0, 10)
    const colName = new Map(collections.map((x) => [x.id, x.name]))
    const res = await c.html(
      <Layout {...layoutProps(c)} title="" description={`${c.var.p.config.appName} 知识库`}>
        <main class="container">
          {collections.length === 0 && (
            <div class="card empty">
              还没有任何集合。
              {hasRole(c.var.user, 'editor') ? <a href="/new">创建第一个集合</a> : !c.var.user && <a href="/login">登录后开始创作</a>}
            </div>
          )}
          <div class="grid">
            {collections.map((col) => {
              const top = readable.filter((d) => d.collection_id === col.id && !d.parent_id)
              return (
                <section class="card">
                  <h2 style="margin:0 0 4px;font-size:18px">
                    <a href={`/c/${col.id}`} style="color:inherit">
                      {col.name}
                    </a>
                  </h2>
                  {col.description && <p class="muted small" style="margin:0 0 10px">{col.description}</p>}
                  <ul class="list small">
                    {top.slice(0, 6).map((d) => (
                      <li style="padding:6px 0">
                        <a href={`/d/${d.id}`}>{d.title || '无标题'}</a>
                      </li>
                    ))}
                    {top.length === 0 && <li class="muted">暂无文档</li>}
                  </ul>
                  {top.length > 6 && (
                    <a class="small" href={`/c/${col.id}`}>
                      查看全部 {top.length} 篇 →
                    </a>
                  )}
                </section>
              )
            })}
          </div>
          {recent.length > 0 && (
            <section style="margin-top:40px">
              <h2 style="font-size:18px">最近更新</h2>
              <ul class="list">
                {recent.map((d) => (
                  <li style="display:flex;gap:12px;align-items:baseline">
                    <a href={`/d/${d.id}`} style="flex:1">
                      {d.title || '无标题'}
                    </a>
                    <span class="muted small">{colName.get(d.collection_id)}</span>
                    <span class="muted small">
                      <Time ts={d.updated_at} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </Layout>,
    )
    return { res, cacheable: true }
  }),
)

/* ---------------- 集合页 ---------------- */

pages.get('/c/:id', rateLimit('read'), (c) =>
  cached(c, `/c/${c.req.param('id')}`, async () => {
    const db = c.var.p.db
    const col = await db.get<{ id: string; name: string; description: string }>(
      'SELECT id, name, description FROM collections WHERE id = ?',
      c.req.param('id'),
    )
    if (!col) return { res: await notFound(c), cacheable: false }
    const docs = filterReadable(
      c.var.user,
      await db.all<TreeRow>(
        'SELECT id, parent_id, title, visibility, author_id, collection_id, updated_at FROM docs WHERE collection_id = ? ORDER BY sort, created_at',
        col.id,
      ),
    )
    const res = await c.html(
      <Layout {...layoutProps(c)} title={col.name} description={col.description || undefined}>
        <main class="container">
          <h1 class="doc-title">{col.name}</h1>
          <div class="doc-meta">
            <span>{docs.length} 篇文档</span>
            {hasRole(c.var.user, 'contributor') && (
              <span class="actions">
                <a class="btn btn-primary btn-sm" href={`/new?collection=${col.id}`}>
                  新建文档
                </a>
              </span>
            )}
          </div>
          {col.description && <p class="muted">{col.description}</p>}
          {docs.length ? <Tree docs={docs} /> : <p class="empty">暂无文档</p>}
        </main>
      </Layout>,
    )
    return { res, cacheable: true }
  }),
)

/* ---------------- 文档阅读页 ---------------- */

pages.get('/d/:id', rateLimit('read'), (c) =>
  cached(c, `/d/${c.req.param('id')}`, async () => {
    const p = c.var.p
    const user = c.var.user
    const doc = await p.db.get<{
      id: string
      collection_id: string
      title: string
      content: string | null
      text: string
      author_id: string
      updated_at: number
      updated_by: string | null
      locked: number
    }>('SELECT id, collection_id, title, content, text, author_id, updated_at, updated_by, locked FROM docs WHERE id = ?', c.req.param('id'))
    if (!doc) return { res: await notFound(c), cacheable: false }
    const chain = await loadChain(p.db, doc.id)
    if (!chainReadable(user, chain)) {
      // 匿名访问受保护文档：提示登录；草稿等其他不可读情况一律 404，不暴露存在性
      const needLogin = !user && chain.every((n) => n.visibility !== 'draft')
      return { res: needLogin ? await loginRequired(c) : await notFound(c), cacheable: false }
    }
    const vis = effectiveVisibility(chain)
    const canEdit = canEditChain(user, chain)
    const [col, tree, editor, comments] = await Promise.all([
      p.db.get<{ id: string; name: string }>('SELECT id, name FROM collections WHERE id = ?', doc.collection_id),
      p.db.all<TreeRow>(
        'SELECT id, parent_id, title, visibility, author_id, collection_id, updated_at FROM docs WHERE collection_id = ? ORDER BY sort, created_at',
        doc.collection_id,
      ),
      p.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', doc.updated_by ?? doc.author_id),
      // 评论只给登录用户看，匿名页面因此可以安全地进入缓存
      user ? listComments(p.db, doc.id) : [],
    ])
    const names = await mentionNames(p, comments.map((x) => x.body))
    const openNotes = comments.filter((x) => x.anchor && !x.parentId && !x.resolved).length
    const readableTree = filterReadable(user, tree)
    const titles = new Map(tree.map((d) => [d.id, d.title]))
    const crumbs = chain.slice(1).reverse()
    const html = doc.content ? jsonToHtml(JSON.parse(doc.content) as PMNode) : ''
    const description = doc.text.slice(0, 160).replace(/\s+/g, ' ')

    const res = await c.html(
      <Layout
        {...layoutProps(c)}
        title={doc.title || '无标题'}
        description={description}
        noindex={vis !== 'public'}
        canonical={vis === 'public' ? `${baseUrl(c)}/d/${doc.id}` : undefined}
      >
        <div class="layout">
          <aside class="sidebar">
            <h3>
              <a href={`/c/${col?.id}`} style="color:inherit">
                {col?.name}
              </a>
            </h3>
            <Tree docs={readableTree} activeId={doc.id} />
          </aside>
          <main class="main">
            <article class="article">
              <nav class="crumbs">
                <a href={`/c/${col?.id}`}>{col?.name}</a>
                {crumbs.map((n) => (
                  <>
                    <span>/</span>
                    <a href={`/d/${n.id}`}>{titles.get(n.id) || '无标题'}</a>
                  </>
                ))}
              </nav>
              <h1 class="doc-title">{doc.title || '无标题'}</h1>
              <div class="doc-meta">
                <VisBadge v={vis} />
                {!!doc.locked && <span class="badge">已锁定</span>}
                <span>
                  {editor?.name ?? '未知'} 更新于 <Time ts={doc.updated_at} />
                </span>
                <span class="actions">
                  <a class="btn btn-sm" href={`/api/docs/${doc.id}/export.md`}>
                    导出 Markdown
                  </a>
                  {user && (
                    <a class="btn btn-sm" href={`/edit/${doc.id}?comments=1`} title="选中文字即可添加批注">
                      批注{openNotes > 0 && ` · ${openNotes}`}
                    </a>
                  )}
                  {canEdit && (
                    <a class="btn btn-primary btn-sm" href={`/edit/${doc.id}`}>
                      编辑
                    </a>
                  )}
                </span>
              </div>
              <div class="prose" dangerouslySetInnerHTML={{ __html: html || '<p class="muted">（空文档）</p>' }} />
              {user && <Discussion docId={doc.id} comments={comments} names={names} userId={user.id} canModerate={hasRole(user, 'editor')} />}
            </article>
          </main>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var v=${doc.updated_at},shown=false;setInterval(function(){if(shown||document.hidden)return;fetch('/api/docs/${doc.id}/version',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.updatedAt>v){shown=true;var n=document.createElement('div');n.className='notice';n.innerHTML='文档已更新<a href="">刷新查看</a>';document.body.appendChild(n)}}).catch(function(){})},20000)})()`,
          }}
        />
      </Layout>,
    )
    return { res, cacheable: vis === 'public' }
  }),
)

/* ---------------- 搜索 ---------------- */

pages.get('/search', rateLimit('read'), async (c) => {
  const q = c.req.query('q') ?? ''
  const results = await searchDocs(c.var.p, c.var.user, q)
  c.header('Cache-Control', 'private, no-store')
  return c.html(
    <Layout {...layoutProps(c)} title={q ? `搜索：${q}` : '搜索'} noindex query={q}>
      <main class="container">
        <h1 style="font-size:20px">{q ? `“${q}” 的搜索结果` : '搜索'}</h1>
        {!c.var.user && q && <p class="muted small">未登录时只搜索公开文档。</p>}
        {q && results.length === 0 && <p class="empty">没有找到相关文档</p>}
        <ul class="list">
          {results.map((r) => (
            <li>
              <a href={`/d/${r.id}`} style="font-weight:600">
                {r.title || '无标题'}
              </a>
              <span class="muted small" style="margin-left:8px">
                {r.collectionName}
              </span>
              <div class="muted small">{r.snippet}</div>
            </li>
          ))}
        </ul>
      </main>
    </Layout>,
  )
})

/* ---------------- SEO ---------------- */

pages.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /edit/\nDisallow: /admin\nDisallow: /search\nCrawl-delay: 2\nSitemap: ${baseUrl(c)}/sitemap.xml\n`),
)

pages.get('/sitemap.xml', rateLimit('read'), async (c) => {
  const all = await c.var.p.db.all<TreeRow>('SELECT id, parent_id, title, visibility, author_id, collection_id, updated_at FROM docs')
  const base = baseUrl(c)
  // 以匿名身份过滤：只有有效可见性为 public 的文档才进入 sitemap
  const urls = filterReadable(null, all)
    .map((d) => `<url><loc>${escapeHtml(`${base}/d/${d.id}`)}</loc><lastmod>${new Date(d.updated_at).toISOString()}</lastmod></url>`)
    .join('')
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=600',
  })
})

/* ---------------- 错误页 ---------------- */

async function notFound(c: Context<AppEnv>): Promise<Response> {
  c.status(404)
  return await c.html(
    <Layout {...layoutProps(c)} title="未找到" noindex>
      <main class="container">
        <div class="card empty">
          <h2>页面不存在</h2>
          <p>文档可能已被删除，或你没有查看权限。</p>
          <a href="/">返回首页</a>
        </div>
      </main>
    </Layout>,
  )
}

async function loginRequired(c: Context<AppEnv>): Promise<Response> {
  c.status(401)
  const next = encodeURIComponent(new URL(c.req.url).pathname)
  return await c.html(
    <Layout {...layoutProps(c)} title="需要登录" noindex>
      <main class="container">
        <div class="card empty">
          <h2>此文档仅对登录用户可见</h2>
          <p>
            <a class="btn btn-primary" href={`/login?next=${next}`}>
              登录后查看
            </a>
          </p>
        </div>
      </main>
    </Layout>,
  )
}

export default pages
