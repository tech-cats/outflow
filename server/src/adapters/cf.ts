import { WorkerMailer } from 'worker-mailer'
import { loadConfig, type Config } from '../config'
import type { DB, Mailer, PMNode, Platform, RateBucket } from '../types'
import { consoleMailer, parseAddress, resendMailer } from './mail-common'

export interface CfEnv {
  DB: D1Database
  UPLOADS: R2Bucket
  COLLAB: DurableObjectNamespace
  ASSETS: Fetcher
  RL_AUTH: RateLimit
  RL_WRITE: RateLimit
  RL_READ: RateLimit
  [key: string]: unknown
}

const norm = (params: unknown[]) =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))

function d1(db: D1Database): DB {
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      const r = await db.prepare(sql).bind(...norm(params)).all<T>()
      return r.results
    },
    async get<T>(sql: string, ...params: unknown[]) {
      return (await db.prepare(sql).bind(...norm(params)).first<T>()) ?? null
    },
    async run(sql: string, ...params: unknown[]) {
      const r = await db.prepare(sql).bind(...norm(params)).run()
      return { changes: r.meta.changes ?? 0 }
    },
  }
}

function smtpMailer(cfg: Config): Mailer {
  const { smtp, from } = cfg.mail
  return {
    async send(msg) {
      // 注意：Workers 禁止出站 25 端口，请使用 465（SMTPS）或 587（STARTTLS）
      await WorkerMailer.send(
        {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          startTls: !smtp.secure,
          credentials: smtp.user ? { username: smtp.user, password: smtp.pass } : undefined,
          authType: ['plain', 'login'],
        },
        { from: parseAddress(from), to: { email: msg.to }, subject: msg.subject, text: msg.text, html: msg.html },
      )
    },
  }
}

const CACHE_ORIGIN = 'https://outflow.cache'

export function cfPlatform(env: CfEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Platform {
  const config = loadConfig(env)
  const rl: Record<RateBucket, RateLimit> = { auth: env.RL_AUTH, write: env.RL_WRITE, read: env.RL_READ }
  return {
    config,
    db: d1(env.DB),
    storage: {
      async put(key, body, contentType) {
        await env.UPLOADS.put(key, body, { httpMetadata: { contentType } })
      },
      async get(key) {
        const obj = await env.UPLOADS.get(key)
        return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream' } : null
      },
      async delete(key) {
        await env.UPLOADS.delete(key)
      },
    },
    mailer:
      config.mail.driver === 'smtp' ? smtpMailer(config) : config.mail.driver === 'resend' ? resendMailer(config) : consoleMailer(),
    rateLimit: {
      async limit(bucket, key) {
        const binding = rl[bucket]
        if (!binding) return true
        const { success } = await binding.limit({ key })
        return success
      },
    },
    // Cache API 只作用于当前数据中心；TTL 很短，更新时清除本地副本
    cache: {
      async match(key) {
        return (await caches.default.match(CACHE_ORIGIN + key)) ?? null
      },
      async put(key, res, ttl) {
        const r = new Response(res.body, res)
        r.headers.set('Cache-Control', `public, max-age=${ttl}`)
        await caches.default.put(CACHE_ORIGIN + key, r)
      },
      async purge(keys) {
        await Promise.all(keys.map((k) => caches.default.delete(CACHE_ORIGIN + k).catch(() => false)))
      },
    },
    collab: {
      async upgrade(req, docId, conn) {
        const stub = env.COLLAB.get(env.COLLAB.idFromName(docId))
        const headers = new Headers(req.headers)
        headers.set('x-doc-id', docId)
        headers.set('x-user-id', conn.userId)
        headers.set('x-readonly', conn.readonly ? '1' : '0')
        return stub.fetch(new Request(req.url, { headers }))
      },
      async replace(docId: string, json: PMNode, editorId: string) {
        const stub = env.COLLAB.get(env.COLLAB.idFromName(docId))
        const res = await stub.fetch('https://collab/replace', {
          method: 'POST',
          headers: { 'x-doc-id': docId, 'x-user-id': editorId, 'content-type': 'application/json' },
          body: JSON.stringify(json),
        })
        if (!res.ok) throw new Error(`replace failed: ${res.status}`)
      },
    },
    clientIp(req) {
      return req.headers.get('cf-connecting-ip') ?? 'unknown'
    },
    waitUntil(p) {
      if (ctx) ctx.waitUntil(p)
      else p.catch((e) => console.error(e))
    },
  }
}
