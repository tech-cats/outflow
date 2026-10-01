import { DurableObject } from 'cloudflare:workers'
import { cfPlatform, type CfEnv } from '../adapters/cf'
import { loadDocState, saveDocState } from '../core/docs'
import { replaceDocContent } from '../lib/prosemirror'
import type { PMNode, Platform } from '../types'
import { Room, type Conn } from './room'

/** 每篇文档一个 Durable Object 实例，承载该文档的 Yjs 房间 */
export class CollabRoom extends DurableObject<CfEnv> {
  private room: Room | null = null
  private platform: Platform | null = null

  private getRoom(docId: string): Room {
    if (!this.room) {
      const p = (this.platform ??= cfPlatform(this.env, this.ctx))
      this.room = new Room({
        load: () => loadDocState(p, docId),
        save: (doc, editorId) => saveDocState(p, docId, doc, editorId),
        onEmpty: () => {
          this.room?.doc.destroy()
          this.room = null
        },
      })
    }
    return this.room
  }

  async fetch(req: Request): Promise<Response> {
    const docId = req.headers.get('x-doc-id')
    if (!docId) return new Response('missing doc id', { status: 400 })
    const room = this.getRoom(docId)

    if (new URL(req.url).pathname === '/replace') {
      const json = (await req.json()) as PMNode
      await room.ready
      replaceDocContent(room.doc, json, { userId: req.headers.get('x-user-id') })
      await room.flush()
      if (room.conns.size === 0) {
        room.doc.destroy()
        this.room = null
      }
      return new Response('ok')
    }

    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    server.accept()
    const conn: Conn = {
      send: (d) => server.send(d),
      close: (code, reason) => {
        try {
          server.close(code, reason)
        } catch {}
      },
      readonly: req.headers.get('x-readonly') === '1',
      userId: req.headers.get('x-user-id') ?? '',
      ids: new Set(),
    }
    // 新版 workerd 默认 binaryType 为 blob；显式改为 arraybuffer，并用有序队列兜底处理 Blob
    ;(server as unknown as { binaryType: string }).binaryType = 'arraybuffer'
    let queue = Promise.resolve()
    server.addEventListener('message', (e) => {
      const data = e.data as unknown
      if (typeof data === 'string') return
      // 同步复制：事件返回后底层缓冲区可能被回收
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data).slice() : null
      queue = queue.then(async () => {
        const u8 = bytes ?? new Uint8Array(await (data as Blob).arrayBuffer())
        await room.message(conn, u8)
      })
    })
    const onClose = () => this.ctx.waitUntil(room.disconnect(conn))
    server.addEventListener('close', onClose)
    server.addEventListener('error', onClose)
    await room.connect(conn)
    return new Response(null, { status: 101, webSocket: client })
  }
}
