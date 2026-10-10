import { RouterProvider, createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CAT_SVG, PAGE_LOADER_DELAY, PAGE_LOADER_JS } from '../../server/src/views/loader'
import { POWERED_BY, baseCss } from '../../server/src/views/styles'
import './app.css'
import { AccountPage } from './pages/Account'
import { AdminPage } from './pages/Admin'
import { NewPage } from './pages/New'
import { NotificationsPage } from './pages/Notifications'
import { pluginPages } from './plugins'
import { SessionProvider } from './session'

// 与服务端阅读页共用同一份基础样式
const style = document.createElement('style')
style.textContent = baseCss
document.head.prepend(style)

// 整页跳转（点普通链接、提交搜索）时的小猫，与服务端页面相同
const loaderScript = document.createElement('script')
loaderScript.textContent = PAGE_LOADER_JS
document.head.append(loaderScript)

/** 前端路由内部跳转（如首次进入编辑器、加载页面代码）时显示小猫 */
function RouteLoader() {
  const pending = useRouterState({ select: (s) => s.status === 'pending' })
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!pending) return setShow(false)
    const t = setTimeout(() => setShow(true), PAGE_LOADER_DELAY)
    return () => clearTimeout(t)
  }, [pending])
  return show ? <div className="page-loader" role="status" aria-label="页面加载中" dangerouslySetInnerHTML={{ __html: CAT_SVG }} /> : null
}

const rootRoute = createRootRoute({
  component: () => {
    // 插件的全屏页面（如地图）占满视口，不显示页脚
    const fullscreen = useRouterState({ select: (s) => s.matches.some((m) => fullscreenPaths.has(m.fullPath)) })
    return (
      <SessionProvider>
        <Outlet />
        <RouteLoader />
        {!fullscreen && <footer className="site-footer" dangerouslySetInnerHTML={{ __html: POWERED_BY }} />}
      </SessionProvider>
    )
  },
  notFoundComponent: () => (
    <div className="container">
      <div className="card empty">
        <h2>页面不存在</h2>
        <a href="/">返回首页</a>
      </div>
    </div>
  ),
})

// 编辑器（TipTap + Yjs）与验证码组件体积较大，按需加载
const EditPage = lazyRouteComponent(() => import('./pages/Edit'), 'EditPage')
const auth = () => import('./pages/Auth')

const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/edit/$id',
  component: function Edit() {
    return <EditPage id={editRoute.useParams().id} />
  },
})

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/login', component: lazyRouteComponent(auth, 'LoginPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/register', component: lazyRouteComponent(auth, 'RegisterPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/reset', component: lazyRouteComponent(auth, 'ResetPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/new', component: NewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/notifications', component: NotificationsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/account', component: AccountPage }),
  editRoute,
]

// route.id 要等路由树构建后才有值，这里按路径记录全屏页面
const fullscreenPaths = new Set(pluginPages.filter((p) => p.fullscreen).map((p) => p.path))
const pluginRoutes = pluginPages.map((page) => {
  const Page = page.component
  return createRoute({ getParentRoute: () => rootRoute, path: page.path, component: () => <Page /> })
})

const router = createRouter({ routeTree: rootRoute.addChildren([...routes, ...pluginRoutes]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
