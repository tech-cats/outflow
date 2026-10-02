import { serve } from '@hono/node-server'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { extname, join, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { migrate, nodePlatform, openSqlite } from '../adapters/node'
import { createApp } from '../app'
import type { Conn } from '../collab/room'
import { canEditChain, chainReadable, loadChain } from '../core/access'
import { SESSION_COOKIE, getSessionUser } from '../core/auth'

const here = import.meta.dirname
const dataDir = resolve(process.env.DATA_DIR ?? join(here, '../../../data'))
const webDist = resolve(process.env.WEB_DIST ?? join(here, '../../../web/dist'))
const port = Number(process.env.PORT ?? 8787)

mkdirSync(dataDir, { recursive: true })
const { db, raw } = openSqlite(join(dataDir, 'outflow.db'))
await migrate(raw, join(here, '../../migrations'))
const p = nodePlatform({ db, dataDir, env: process.env })

if (p.config.mail.driver === 'console') {
  console.warn('[警告] MAIL_DRIVER=console：邮件不会真正发出，验证码会打印在日志中，仅限开发使用')
} else if (p.config.mail.driver === 'none') {
  console.warn('[警告] 未配置邮件服务（SMTP_HOST / RESEND_API_KEY），注册与找回密码将不可用')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

/** 静态资源 + SPA 回退到 index.html */
async function serveWeb(pathname: string): Promise<Response> {
  const file = resolve(webDist, '.' + decodeURIComponent(pathname))
  if (file.startsWith(webDist + '/')) {
    const s = await stat(file).catch(() => null)
    if (s?.isFile()) {
      const immutable = pathname.startsWith('/assets/')
      return new Response(await readFile(file), {
        headers: {
          'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      })
    }
  }
  const index = join(webDist, 'index.html')
  if (!existsSync(index)) return new Response('web/dist 不存在，请先执行 pnpm build（开发时请访问 Vite 端口）', { status: 404 })
  return new Response(await readFile(index), { headers: { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' } })
}

const app = createApp({
  getPlatform: () => p,
  staticFallback: (c) => serveWeb(c.req.path),
})

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Outflow 已启动：http://localhost:${info.port}`)
})

/* ---------------- 实时协作 WebSocket ---------------- */

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })

function reject(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
}

server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  try {
    const m = (req.url ?? '').match(/^\/api\/collab\/([a-z0-9]+)(?:\?|$)/)
    if (!m) return reject(socket, '404 Not Found')
    // 防止跨站 WebSocket 劫持
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host) return reject(socket, '403 Forbidden')
    const user = await getSessionUser(p, readCookie(req, SESSION_COOKIE))
    if (!user) return reject(socket, '401 Unauthorized')
    const docId = m[1]
    const chain = await loadChain(p.db, docId)
    if (!chainReadable(user, chain)) return reject(socket, '404 Not Found')
    const readonly = !canEditChain(user, chain)

    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = p.getRoom(docId)
      const conn: Conn = {
        send: (d) => ws.send(d),
        close: (code, reason) => ws.close(code, reason),
        readonly,
        userId: user.id,
        ids: new Set(),
      }
      ws.binaryType = 'arraybuffer'
      ws.on('message', (data) => void room.message(conn, new Uint8Array(data as ArrayBuffer)))
      ws.on('close', () => void room.disconnect(conn))
      ws.on('error', () => void room.disconnect(conn))
      void room.connect(conn)
    })
  } catch (err) {
    console.error('upgrade error', err)
    reject(socket, '500 Internal Server Error')
  }
})

async function shutdown() {
  console.log('正在保存协作中的文档…')
  await Promise.all([...p.rooms.values()].map((r) => r.flush()))
  raw.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
