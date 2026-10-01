import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

/**
 * 与运行时无关的 Yjs 房间，协议兼容 y-websocket 客户端。
 * CF 上由 Durable Object 承载，Node 上由进程内 Map 承载。
 */

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024

export interface Conn {
  send(data: Uint8Array): void
  close(code?: number, reason?: string): void
  readonly: boolean
  userId: string
  /** 该连接拥有的 awareness clientID */
  ids: Set<number>
}

export interface RoomHooks {
  load(): Promise<Uint8Array | null>
  save(doc: Y.Doc, editorId: string | null): Promise<void>
  onEmpty?(): void
}

export class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  readonly conns = new Set<Conn>()
  readonly ready: Promise<void>
  private dirty = false
  private lastEditor: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private hooks: RoomHooks,
    private saveDelayMs = 3000,
  ) {
    this.awareness.setLocalState(null)
    this.ready = hooks.load().then((state) => {
      if (state) Y.applyUpdate(this.doc, state, 'load')
    })

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      this.broadcast(encoding.toUint8Array(enc))
      if (origin === 'load') return
      if (origin && typeof origin === 'object' && 'userId' in origin) {
        this.lastEditor = (origin as { userId: string }).userId
      }
      this.markDirty()
    })

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = [...added, ...updated, ...removed]
        if (origin && this.conns.has(origin as Conn)) {
          const c = origin as Conn
          added.forEach((id) => c.ids.add(id))
          removed.forEach((id) => c.ids.delete(id))
        }
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_AWARENESS)
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
        this.broadcast(encoding.toUint8Array(enc))
      },
    )
  }

  private broadcast(msg: Uint8Array) {
    for (const c of this.conns) {
      try {
        c.send(msg)
      } catch {
        void this.disconnect(c)
      }
    }
  }

  async connect(conn: Conn) {
    await this.ready
    this.conns.add(conn)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, this.doc)
    conn.send(encoding.toUint8Array(enc))
    const states = this.awareness.getStates()
    if (states.size > 0) {
      const a = encoding.createEncoder()
      encoding.writeVarUint(a, MSG_AWARENESS)
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]))
      conn.send(encoding.toUint8Array(a))
    }
  }

  async message(conn: Conn, data: Uint8Array) {
    await this.ready
    if (!this.conns.has(conn)) return
    if (data.byteLength > MAX_MESSAGE_BYTES) {
      conn.close(1009, 'message too large')
      return
    }
    try {
      const decoder = decoding.createDecoder(data)
      const enc = encoding.createEncoder()
      const type = decoding.readVarUint(decoder)
      if (type === MSG_SYNC) {
        // 只读连接只允许请求同步（step1），不允许写入
        if (conn.readonly && decoding.peekVarUint(decoder) !== syncProtocol.messageYjsSyncStep1) return
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.readSyncMessage(decoder, enc, this.doc, conn)
        if (encoding.length(enc) > 1) conn.send(encoding.toUint8Array(enc))
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn)
      }
    } catch (err) {
      console.error('collab message error', err)
      conn.close(1003, 'bad message')
    }
  }

  async disconnect(conn: Conn) {
    if (!this.conns.delete(conn)) return
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.ids], null)
    if (this.conns.size === 0) {
      await this.flush()
      this.hooks.onEmpty?.()
    }
  }

  private markDirty() {
    this.dirty = true
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.saveDelayMs)
    }
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty) return
    this.dirty = false
    try {
      await this.hooks.save(this.doc, this.lastEditor)
    } catch (err) {
      console.error('collab save failed', err)
      this.markDirty()
    }
  }

  closeAll(reason: string) {
    for (const c of [...this.conns]) c.close(4000, reason)
  }
}
