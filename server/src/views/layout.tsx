import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { hasRole } from '../core/access'
import { pluginNav } from '../plugins/host'
import type { User, Visibility } from '../types'
import { POWERED_BY, THEME_INIT_JS, THEME_TOGGLE_JS, baseCss } from './styles'

export interface LayoutProps {
  title: string
  appName: string
  user: User | null
  description?: string
  noindex?: boolean
  canonical?: string
  query?: string
  /** 页面自带搜索框时隐藏顶栏搜索 */
  hideSearch?: boolean
  children: Child
}

export function Layout(props: LayoutProps) {
  const fullTitle = props.title ? `${props.title} · ${props.appName}` : props.appName
  return (
    <>
    {raw('<!DOCTYPE html>')}
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_JS }} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        {props.description && <meta name="description" content={props.description} />}
        {props.noindex && <meta name="robots" content="noindex" />}
        {props.canonical && <link rel="canonical" href={props.canonical} />}
        <meta property="og:title" content={fullTitle} />
        {props.description && <meta property="og:description" content={props.description} />}
        <meta property="og:type" content="article" />
        <link rel="icon" href={FAVICON} />
        <style dangerouslySetInnerHTML={{ __html: baseCss }} />
      </head>
      <body>
        <header class="topbar">
          <a class="brand" href="/">
            <span class="brand-mark" />
            {props.appName}
          </a>
          {!props.hideSearch && (
            <form class="search" action="/search" method="get">
              <input class="input" type="search" name="q" placeholder="搜索文档…" value={props.query ?? ''} />
            </form>
          )}
          <div class="spacer" />
          <nav class="nav">
            <button class="theme-toggle" id="theme-toggle" title="切换深色/浅色" aria-label="切换深色/浅色">
              ◐
            </button>
            <a href="/c">全部文档</a>
            {pluginNav.map((n) => (
              <a href={n.href}>{n.label}</a>
            ))}
            {props.user ? (
              <>
                {hasRole(props.user, 'contributor') && (
                  <a class="btn btn-primary btn-sm" href="/new">
                    写文档
                  </a>
                )}
                <a href="/notifications" class="bell" title="通知">
                  通知<span class="bell-count" id="bell-count" hidden />
                </a>
                {props.user.role === 'admin' && <a href="/admin">管理</a>}
                <span class="muted">{props.user.name}</span>
                <button class="link" id="logout">
                  退出
                </button>
              </>
            ) : (
              <>
                <a href="/login">登录</a>
                <a class="btn btn-sm" href="/register">
                  注册
                </a>
              </>
            )}
          </nav>
        </header>
        {props.children}
        <footer class="site-footer" dangerouslySetInnerHTML={{ __html: POWERED_BY }} />
        <script dangerouslySetInnerHTML={{ __html: TIME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: `document.getElementById('theme-toggle').onclick=${THEME_TOGGLE_JS}` }} />
        {props.user && (
          <script
            dangerouslySetInnerHTML={{
              __html: `document.getElementById('logout').onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location.reload()};${BELL_JS}`,
            }}
          />
        )}
      </body>
    </html>
    </>
  )
}

/** 未读通知数：登录页面不缓存，但计数用接口取，避免每次渲染都查库 */
const BELL_JS = `(function(){var el=document.getElementById('bell-count');function f(){if(document.hidden)return;fetch('/api/notifications/unread',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(!d)return;el.textContent=d.count>99?'99+':d.count;el.hidden=!d.count}).catch(function(){})}f();setInterval(f,60000)})()`

const VIS_LABEL: Record<Visibility, string> = { public: '公开', protected: '仅登录可见', draft: '草稿' }

export function VisBadge({ v }: { v: Visibility }) {
  return <span class={`badge ${v}`}>{VIS_LABEL[v]}</span>
}

export interface TreeDoc {
  id: string
  parent_id: string | null
  title: string
}

export function Tree({ docs, activeId }: { docs: TreeDoc[]; activeId?: string }) {
  const children = new Map<string | null, TreeDoc[]>()
  for (const d of docs) {
    const k = d.parent_id && docs.some((x) => x.id === d.parent_id) ? d.parent_id : null
    children.set(k, [...(children.get(k) ?? []), d])
  }
  const render = (parent: string | null, depth: number): Child => {
    const list = children.get(parent)
    if (!list || depth > 20) return null
    return (
      <ul>
        {list.map((d) => (
          <li>
            <a href={`/d/${d.id}`} class={d.id === activeId ? 'active' : ''} title={d.title || '无标题'}>
              {d.title || '无标题'}
            </a>
            {render(d.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }
  return <div class="tree">{render(null, 0)}</div>
}

/** 服务端输出 UTC 时间，浏览器端再转换为本地时间 */
export function Time({ ts }: { ts: number }) {
  return (
    <time data-ts={String(ts)} datetime={new Date(ts).toISOString()}>
      {new Date(ts).toISOString().slice(0, 16).replace('T', ' ')}
    </time>
  )
}

const TIME_SCRIPT = `document.querySelectorAll('time[data-ts]').forEach(function(t){var d=new Date(+t.dataset.ts),p=function(n){return String(n).padStart(2,'0')};t.textContent=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())})`

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%232f6feb'/><stop offset='1' stop-color='%238a5cf6'/></linearGradient></defs><rect width='32' height='32' rx='8' fill='url(%23g)'/></svg>"
