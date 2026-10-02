import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { SESSION_COOKIE, getSessionUser } from './core/auth'
import admin from './routes/admin'
import auth from './routes/auth'
import comments from './routes/comments'
import notifications from './routes/notifications'
import docs from './routes/docs'
import { mountPlugins } from './plugins/host'
import pages from './routes/pages'
import { uploadApi, uploadFiles } from './routes/uploads'
import type { AppEnv, Platform } from './types'

// 只有这些路径由服务端处理，其余交给静态资源（SPA）
const DYNAMIC = /^\/(api\/|c\/|d\/|uploads\/|search$|sitemap\.xml$|robots\.txt$|$)/

export function createApp(opts: {
  getPlatform(c: Context<AppEnv>): Platform
  staticFallback(c: Context<AppEnv>): Response | Promise<Response>
}) {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    if (!DYNAMIC.test(c.req.path)) return opts.staticFallback(c)
    const p = opts.getPlatform(c)
    c.set('p', p)
    c.set('user', await getSessionUser(p, getCookie(c, SESSION_COOKIE)))
    await next()
    if (c.res.status !== 101) {
      try {
        c.res.headers.set('X-Content-Type-Options', 'nosniff')
        c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        c.res.headers.set('X-Frame-Options', 'SAMEORIGIN')
      } catch {
        // 部分响应（如缓存命中）的 headers 不可变
      }
    }
  })

  // 对表单类请求校验 Origin；JSON 请求跨域需预检，天然被同源策略拦截
  // 比较 host 而非完整 origin：反向代理终止 TLS 时服务端看到的协议是 http
  app.use(
    '/api/*',
    csrf({
      origin: (origin, c) => {
        try {
          return new URL(origin).host === new URL(c.req.url).host || origin === c.var.p.config.appUrl
        } catch {
          return false
        }
      },
    }),
  )

  app.route('/api', auth)
  app.route('/api', docs)
  app.route('/api', comments)
  app.route('/api', notifications)
  app.route('/api', uploadApi)
  app.route('/api/admin', admin)
  mountPlugins(app)
  app.route('/', uploadFiles)
  app.route('/', pages)

  app.all('/api/*', (c) => c.json({ error: '接口不存在' }, 404))
  app.notFound((c) => opts.staticFallback(c))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: '服务器内部错误' }, 500)
  })
  return app
}
