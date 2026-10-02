import { Extension, type Editor } from '@tiptap/react'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { api, formatTime, type User } from '../api'

export interface Comment {
  id: string
  parentId: string | null
  authorId: string
  authorName: string | null
  body: string
  anchor: string | null
  quote: string | null
  resolved: boolean
  createdAt: number
}

interface CommentsData {
  comments: Comment[]
  canModerate: boolean
  canResolveAll: boolean
}

/** 正在新建的行内批注 */
export interface PendingNote {
  anchor: string
  quote: string
}

const PENDING_ID = '__pending'

/* ---------------- 锚点：Yjs 相对位置 ----------------
 * 批注不写进文档内容（成员没有写权限），而是记录选区两端的 Yjs 相对位置。
 * 文档被并发编辑后仍能定位到原文；原文被整段删除时锚点失效。 */

const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function binding(state: EditorState) {
  return ySyncPluginKey.getState(state)?.binding as
    | { doc: Y.Doc; type: Y.XmlFragment; mapping: Map<Y.AbstractType<unknown>, unknown> }
    | undefined
}

export function makeAnchor(state: EditorState, from: number, to: number): string | null {
  const b = binding(state)
  if (!b) return null
  const enc = (pos: number) => toB64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos, b.type, b.mapping as never)))
  return JSON.stringify({ from: enc(from), to: enc(to) })
}

const decoded = new Map<string, { from: Y.RelativePosition; to: Y.RelativePosition } | null>()

export function resolveAnchor(state: EditorState, anchor: string): { from: number; to: number } | null {
  const b = binding(state)
  if (!b) return null
  let rel = decoded.get(anchor)
  if (rel === undefined) {
    try {
      const a = JSON.parse(anchor)
      rel = { from: Y.decodeRelativePosition(fromB64(a.from)), to: Y.decodeRelativePosition(fromB64(a.to)) }
    } catch {
      rel = null
    }
    decoded.set(anchor, rel)
  }
  if (!rel) return null
  const from = relativePositionToAbsolutePosition(b.doc, b.type, rel.from, b.mapping as never)
  const to = relativePositionToAbsolutePosition(b.doc, b.type, rel.to, b.mapping as never)
  if (from === null || to === null || from >= to || to > state.doc.content.size) return null
  return { from, to }
}

/** 把编辑器滚动到锚点所在位置 */
export function scrollToAnchor(editor: Editor, anchor: string) {
  const pos = resolveAnchor(editor.state, anchor)
  if (!pos) return
  const { node } = editor.view.domAtPos(pos.from)
  ;(node instanceof HTMLElement ? node : node.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/* ---------------- 编辑器内高亮 ---------------- */

interface AnchorState {
  anchors: { id: string; anchor: string }[]
  active: string | null
}

const commentsKey = new PluginKey<AnchorState>('commentAnchors')

export function setAnchors(editor: Editor, anchors: AnchorState['anchors'], active: string | null) {
  editor.view.dispatch(editor.state.tr.setMeta(commentsKey, { anchors, active }))
}

export const CommentAnchors = Extension.create<{ onActivate(id: string): void }>({
  name: 'commentAnchors',
  addOptions() {
    return { onActivate: () => {} }
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<AnchorState>({
        key: commentsKey,
        state: {
          init: () => ({ anchors: [], active: null }),
          apply: (tr, v) => (tr.getMeta(commentsKey) as Partial<AnchorState> | undefined) ? { ...v, ...tr.getMeta(commentsKey) } : v,
        },
        props: {
          decorations(state) {
            const { anchors, active } = commentsKey.getState(state)!
            const decos: Decoration[] = []
            for (const a of anchors) {
              const r = resolveAnchor(state, a.anchor)
              if (!r) continue
              const cls = `comment-mark${a.id === active || a.id === PENDING_ID ? ' active' : ''}`
              decos.push(Decoration.inline(r.from, r.to, { class: cls, 'data-comment': a.id }))
            }
            return DecorationSet.create(state.doc, decos)
          },
          handleDOMEvents: {
            click(_view, e) {
              const id = (e.target as HTMLElement).closest?.('[data-comment]')?.getAttribute('data-comment')
              if (id && id !== PENDING_ID) options.onActivate(id)
              return false
            },
          },
        },
        // y-tiptap 在视图更新阶段才同步位置映射，本地编辑后补一次重算，避免高亮落后一步
        view: () => ({
          update(view, prev) {
            if (prev.doc === view.state.doc || !commentsKey.getState(view.state)?.anchors.length) return
            setTimeout(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(commentsKey, {})), 0)
          },
        }),
      }),
    ]
  },
})

/* ---------------- 数据 ---------------- */

/**
 * 加载评论；任何人增删评论后通过 awareness 广播一个版本号，
 * 同文档的其他客户端（包括只读的成员）看到后重新拉取。
 */
export function useComments(docId: string, provider: WebsocketProvider) {
  const [data, setData] = useState<CommentsData | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await api<CommentsData>(`/docs/${docId}/comments`))
    } catch {
      // 网络波动时保留旧数据
    }
  }, [docId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const aw = provider.awareness
    const seen = new Map<number, number>()
    const onChange = () => {
      let changed = false
      aw.getStates().forEach((s, id) => {
        if (id === aw.clientID) return
        const rev = typeof s.commentRev === 'number' ? s.commentRev : 0
        if (seen.has(id) && seen.get(id) !== rev) changed = true
        seen.set(id, rev)
      })
      if (changed) void reload()
    }
    aw.on('change', onChange)
    return () => aw.off('change', onChange)
  }, [provider, reload])

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (e) {
        alert((e as Error).message)
        return false
      }
      provider.awareness.setLocalStateField('commentRev', Date.now())
      await reload()
      return true
    },
    [provider, reload],
  )

  return { data, mutate }
}

export type CommentsApi = ReturnType<typeof useComments>

/* ---------------- 选中文字后的浮动按钮 ---------------- */

/** 跟踪编辑器内的 DOM 选区（只读模式下 ProseMirror 不一定更新自身选区，因此直接读 DOM） */
export function useSelectionRange(editor: Editor | null) {
  const [sel, setSel] = useState<{ from: number; to: number; top: number; left: number } | null>(null)
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const s = window.getSelection()
      if (!s || s.isCollapsed || !s.rangeCount) return setSel(null)
      const range = s.getRangeAt(0)
      if (!editor.view.dom.contains(range.commonAncestorContainer)) return setSel(null)
      let from: number, to: number
      try {
        from = editor.view.posAtDOM(range.startContainer, range.startOffset)
        to = editor.view.posAtDOM(range.endContainer, range.endOffset)
      } catch {
        return setSel(null)
      }
      if (from >= to || !editor.state.doc.textBetween(from, to, ' ').trim()) return setSel(null)
      const rects = range.getClientRects()
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
      setSel({ from, to, top: last.bottom + 6, left: Math.min(last.right, window.innerWidth - 90) })
    }
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [editor])
  return sel
}

export function NoteButton({ top, left, onClick }: { top: number; left: number; onClick(): void }) {
  return (
    <button
      className="note-btn"
      style={{ top, left }}
      // 阻止默认行为，点击时不丢失选区
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      💬 批注
    </button>
  )
}

/* ---------------- 讨论串 ---------------- */

function Composer(props: { placeholder: string; submitLabel: string; autoFocus?: boolean; onSubmit(body: string): Promise<boolean>; onCancel?(): void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    if (await props.onSubmit(body)) setBody('')
    setBusy(false)
  }
  return (
    <form className="comment-form" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <textarea
        className="input"
        rows={2}
        maxLength={2000}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          if (e.key === 'Escape') props.onCancel?.()
        }}
      />
      <div className="row-gap">
        <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" className="btn btn-sm" onClick={props.onCancel}>
            取消
          </button>
        )}
      </div>
    </form>
  )
}

function CommentItem({ c, canDelete, onDelete }: { c: Comment; canDelete: boolean; onDelete(): void }) {
  return (
    <div className="comment">
      <div className="comment-head">
        <strong>{c.authorName ?? '已注销用户'}</strong>
        <span>{formatTime(c.createdAt)}</span>
        {canDelete && (
          <button className="link comment-del" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
      <div className="comment-body">{c.body}</div>
    </div>
  )
}

function Thread(props: {
  root: Comment
  replies: Comment[]
  docId: string
  me: User
  data: CommentsData
  mutate: CommentsApi['mutate']
  /** 行内批注才有引用与解决 */
  inline?: { orphan: boolean; active: boolean; onActivate(): void; onLocate(): void }
}) {
  const { root, me, data, mutate } = props
  const [replying, setReplying] = useState(false)
  const canDelete = (c: Comment) => c.authorId === me.id || data.canModerate
  const del = (c: Comment) => {
    if (confirm(c.parentId ? '删除这条回复？' : '删除这条讨论及其所有回复？')) void mutate(() => api(`/comments/${c.id}`, { method: 'DELETE' }))
  }
  const canResolve = data.canResolveAll || root.authorId === me.id
  return (
    <div className={`thread${props.inline?.active ? ' active' : ''}${root.resolved ? ' resolved' : ''}`} onClick={props.inline?.onActivate}>
      {props.inline && (
        <blockquote className={`note-quote${props.inline.orphan ? ' orphan' : ''}`} onClick={props.inline.onLocate} title={props.inline.orphan ? '原文已被删除或修改' : '定位到原文'}>
          {root.quote || '（无引用）'}
        </blockquote>
      )}
      <CommentItem c={root} canDelete={canDelete(root)} onDelete={() => del(root)} />
      {props.replies.map((r) => (
        <CommentItem key={r.id} c={r} canDelete={canDelete(r)} onDelete={() => del(r)} />
      ))}
      {replying ? (
        <Composer
          placeholder="回复…"
          submitLabel="回复"
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            const ok = await mutate(() => api(`/docs/${props.docId}/comments`, { body: { body, parentId: root.id } }))
            if (ok) setReplying(false)
            return ok
          }}
        />
      ) : (
        <div className="thread-actions">
          <button
            className="link small"
            onClick={(e) => {
              e.stopPropagation()
              setReplying(true)
            }}
          >
            回复
          </button>
          {props.inline && canResolve && (
            <button
              className="link small"
              onClick={(e) => {
                e.stopPropagation()
                void mutate(() => api(`/comments/${root.id}`, { method: 'PATCH', body: { resolved: !root.resolved } }))
              }}
            >
              {root.resolved ? '重新打开' : '解决'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------- 行内批注面板 ---------------- */

export function NotesPanel(props: {
  editor: Editor
  docId: string
  me: User
  comments: CommentsApi
  pending: PendingNote | null
  onPendingDone(): void
  active: string | null
  setActive(id: string | null): void
  onClose(): void
}) {
  const { editor, comments, active } = props
  const data = comments.data
  const [showResolved, setShowResolved] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // 宽屏下给面板让出空间，避免遮住正文
  useEffect(() => {
    document.body.classList.add('notes-open')
    return () => document.body.classList.remove('notes-open')
  }, [])

  // 编辑器里点击高亮时，把对应的讨论滚动到可见区域
  useEffect(() => {
    if (active) listRef.current?.querySelector(`[data-thread="${active}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  if (!data) return null
  const roots = data.comments.filter((c) => c.anchor && !c.parentId)
  const withPos = roots.map((r) => ({ r, pos: resolveAnchor(editor.state, r.anchor!) }))
  withPos.sort((a, b) => (a.pos?.from ?? Infinity) - (b.pos?.from ?? Infinity) || a.r.createdAt - b.r.createdAt)
  const open = withPos.filter((x) => !x.r.resolved)
  const resolved = withPos.filter((x) => x.r.resolved)

  const locate = (id: string, anchor: string) => {
    props.setActive(id)
    scrollToAnchor(editor, anchor)
  }

  const render = ({ r, pos }: (typeof withPos)[number]) => (
    <div key={r.id} data-thread={r.id}>
      <Thread
        root={r}
        replies={data.comments.filter((c) => c.parentId === r.id)}
        docId={props.docId}
        me={props.me}
        data={data}
        mutate={comments.mutate}
        inline={{ orphan: !pos, active: active === r.id, onActivate: () => props.setActive(r.id), onLocate: () => locate(r.id, r.anchor!) }}
      />
    </div>
  )

  return (
    <div className="drawer drawer-narrow">
      <div className="drawer-head">
        <strong>批注</strong>
        <button className="btn btn-sm" onClick={props.onClose}>
          关闭
        </button>
      </div>
      {props.pending && (
        <div className="thread active">
          <blockquote className="note-quote">{props.pending.quote}</blockquote>
          <Composer
            placeholder="写下你的批注…（⌘/Ctrl + Enter 发送）"
            submitLabel="发表批注"
            autoFocus
            onCancel={props.onPendingDone}
            onSubmit={async (body) => {
              const p = props.pending!
              const ok = await comments.mutate(() => api(`/docs/${props.docId}/comments`, { body: { body, anchor: p.anchor, quote: p.quote } }))
              if (ok) props.onPendingDone()
              return ok
            }}
          />
        </div>
      )}
      <div ref={listRef}>
        {open.map(render)}
        {!open.length && !props.pending && <p className="muted small">暂无批注。选中正文中的文字即可添加。</p>}
        {resolved.length > 0 && (
          <>
            <button className="link small resolved-toggle" onClick={() => setShowResolved(!showResolved)}>
              {showResolved ? '隐藏' : '显示'}已解决（{resolved.length}）
            </button>
            {showResolved && resolved.map(render)}
          </>
        )}
      </div>
    </div>
  )
}

/** 同步高亮：未解决的批注 + 正在新建的批注 */
export function useAnchorSync(editor: Editor | null, data: CommentsData | null, pending: PendingNote | null, active: string | null) {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const anchors = (data?.comments ?? []).filter((c) => c.anchor && !c.parentId && !c.resolved).map((c) => ({ id: c.id, anchor: c.anchor! }))
    if (pending) anchors.push({ id: PENDING_ID, anchor: pending.anchor })
    setAnchors(editor, anchors, active)
  }, [editor, data, pending, active])
}

/* ---------------- 文末讨论 ---------------- */

export function Discussion({ docId, me, comments }: { docId: string; me: User; comments: CommentsApi }) {
  const data = comments.data
  if (!data) return null
  const roots = data.comments.filter((c) => !c.anchor && !c.parentId)
  const count = roots.reduce((n, r) => n + 1 + data.comments.filter((c) => c.parentId === r.id).length, 0)
  return (
    <section className="discussion">
      <h2>
        讨论 {count > 0 && <span className="muted">{count}</span>}
      </h2>
      {roots.map((r) => (
        <Thread key={r.id} root={r} replies={data.comments.filter((c) => c.parentId === r.id)} docId={docId} me={me} data={data} mutate={comments.mutate} />
      ))}
      <Composer placeholder="参与讨论…" submitLabel="发表" onSubmit={(body) => comments.mutate(() => api(`/docs/${docId}/comments`, { body: { body } }))} />
    </section>
  )
}
