import { RouterProvider, createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import { POWERED_BY, baseCss } from '../../server/src/views/styles'
import './app.css'
import { AdminPage } from './pages/Admin'
import { NewPage } from './pages/New'
import { SessionProvider } from './session'

// 与服务端阅读页共用同一份基础样式
const style = document.createElement('style')
style.textContent = baseCss
document.head.prepend(style)

const rootRoute = createRootRoute({
  component: () => (
    <SessionProvider>
      <Outlet />
      <footer className="site-footer" dangerouslySetInnerHTML={{ __html: POWERED_BY }} />
    </SessionProvider>
  ),
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
  editRoute,
]

const router = createRouter({ routeTree: rootRoute.addChildren(routes) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
