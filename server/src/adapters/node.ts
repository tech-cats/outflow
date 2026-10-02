import nodemailer from 'nodemailer'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { loadConfig, type Config } from '../config'
import { Room } from '../collab/room'
import { loadDocState, saveDocState } from '../core/docs'
import { replaceDocContent } from '../lib/prosemirror'
import type { DB, Mailer, Platform } from '../types'
import { pickMailer } from './mail-common'
import { memoryRateLimiter } from './memory-ratelimit'

const norm = (params: unknown[]) =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as SQLInputValue[]

/** 使用 Node 内置的 node:sqlite：无需原生编译，安装与 Docker 构建都更快 */
export function openSqlite(file: string): { db: DB; raw: DatabaseSync } {
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  const db: DB = {
    async all<T>(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).all(...norm(params)) as T[]
    },
    async get<T>(sql: string, ...params: unknown[]) {
      return (raw.prepare(sql).get(...norm(params)) as T | undefined) ?? null
    },
    async run(sql: string, ...params: unknown[]) {
      return { changes: Number(raw.prepare(sql).run(...norm(params)).changes) }
    },
  }
  return { db, raw }
}

/** 按文件名顺序执行 migrations/*.sql，与 wrangler d1 migrations 共用同一份 SQL */
export async function migrate(raw: DatabaseSync, dir: string) {
  raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const done = new Set((raw.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (done.has(f)) continue
    const sql = await readFile(join(dir, f), 'utf8')
    raw.exec('BEGIN')
    try {
      raw.exec(sql)
      raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now())
      raw.exec('COMMIT')
    } catch (err) {
      raw.exec('ROLLBACK')
      throw err
    }
    console.log(`[migrate] applied ${f}`)
  }
}

function smtpMailer(cfg: Config): Mailer {
  const { smtp, from } = cfg.mail
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
  return {
    async send(msg) {
      await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html })
    },
  }
}

export interface NodePlatform extends Platform {
  rooms: Map<string, Room>
  getRoom(docId: string): Room
}

export function nodePlatform(opts: { db: DB; dataDir: string; env: Record<string, unknown> }): NodePlatform {
  const config = loadConfig(opts.env)
  const uploadDir = resolve(opts.dataDir, 'uploads')
  const safePath = (key: string) => {
    const p = resolve(uploadDir, key)
    if (!p.startsWith(uploadDir + '/')) throw new Error('invalid key')
    return p
  }
  const rooms = new Map<string, Room>()
  // 部署在反向代理之后时设为 true，才信任 X-Forwarded-For
  const trustProxy = opts.env.TRUST_PROXY === 'true'

  const p: NodePlatform = {
    config,
    db: opts.db,
    storage: {
      async put(key, body, contentType) {
        const file = safePath(key)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, new Uint8Array(body))
        await writeFile(file + '.type', contentType)
      },
      async get(key) {
        try {
          const file = safePath(key)
          const [body, type] = await Promise.all([readFile(file), readFile(file + '.type', 'utf8')])
          return { body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, contentType: type }
        } catch {
          return null
        }
      },
      async delete(key) {
        const file = safePath(key)
        await Promise.all([unlink(file).catch(() => {}), unlink(file + '.type').catch(() => {})])
      },
    },
    mailer:
      pickMailer(config, smtpMailer),
    rateLimit: memoryRateLimiter(),
    // 自部署时 SQLite 就在本地，无需页面缓存
    cache: {
      async match() {
        return null
      },
      async put() {},
      async purge() {},
    },
    collab: {
      async replace(docId, json, editorId) {
        const room = p.getRoom(docId)
        await room.ready
        replaceDocContent(room.doc, json, { userId: editorId })
        await room.flush()
        if (room.conns.size === 0) {
          rooms.delete(docId)
          room.doc.destroy()
        }
      },
    },
    clientIp(req, rawEnv) {
      if (trustProxy) {
        const xff = req.headers.get('x-forwarded-for')
        if (xff) return xff.split(',')[0].trim()
        const real = req.headers.get('x-real-ip')
        if (real) return real
      }
      const sock = (rawEnv as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket
      return sock?.remoteAddress ?? 'unknown'
    },
    waitUntil(promise) {
      promise.catch((e) => console.error(e))
    },
    rooms,
    getRoom(docId) {
      let room = rooms.get(docId)
      if (!room) {
        room = new Room({
          load: () => loadDocState(p, docId),
          save: (doc, editorId) => saveDocState(p, docId, doc, editorId),
          onEmpty: () => {
            if (rooms.get(docId) === room) rooms.delete(docId)
            room!.doc.destroy()
          },
        })
        rooms.set(docId, room)
      }
      return room
    },
  }
  return p
}
