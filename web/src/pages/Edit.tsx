import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { ApiError, VIS_HINT, VIS_LABEL, api, createDoc, formatTime, hasRole, type DocMeta, type User, type Visibility } from '../api'
import {
  CommentAnchors,
  Discussion,
  NoteButton,
  NotesPanel,
  makeAnchor,
  useAnchorSync,
  useComments,
  useSelectionRange,
  type CommentsApi,
  type PendingNote,
} from '../components/Comments'
import { DocTree } from '../components/DocTree'
import { Toolbar } from '../components/Toolbar'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

interface DocDetail {
  doc: DocMeta & { effectiveVisibility: Visibility; authorName: string | null; updatedByName: string | null }
  collection: { id: string; name: string }
  breadcrumbs: { id: string; title: string }[]
  canEdit: boolean
  canDraft: boolean
}

/** 与服务端 canEditChain 对应（祖先可读性已由树接口保证） */
function canEditDoc(user: User, d: DocMeta) {
  if (user.role === 'admin') return true
  if (d.locked) return false
  return hasRole(user, 'editor') || (hasRole(user, 'contributor') && d.authorId === user.id)
}

function colorFor(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 70% 45%)`
}

export function EditPage({ id }: { id: string }) {
  const { user, loading } = useSession()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [tree, setTree] = useState<DocMeta[]>([])
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'none' | 'history' | 'settings'>('none')

  const load = useCallback(async () => {
    try {
      const d = await api<DocDetail>(`/docs/${id}`)
      setDetail(d)
      const t = await api<{ docs: DocMeta[] }>(`/collections/${d.collection.id}/tree`)
      setTree(t.docs)
    } catch (e) {
      const err = e as ApiError
      if (err.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname)}`
      else setError(err.message)
    }
  }, [id])

  useEffect(() => {
    setDetail(null)
    setPanel('none')
    void load()
  }, [load])

  useEffect(() => {
    if (!loading && !user) location.href = `/login?next=${encodeURIComponent(location.pathname)}`
  }, [loading, user])

  const refreshTree = useCallback(async () => {
    if (!detail) return
    const t = await api<{ docs: DocMeta[] }>(`/collections/${detail.collection.id}/tree`)
    setTree(t.docs)
  }, [detail])

  const addChild = async (parentId: string | null) => {
    if (!detail) return
    try {
      const nid = await createDoc(detail.collection.id, parentId)
      navigate({ to: '/edit/$id', params: { id: nid } })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (error) {
    return (
      <>
        <Topbar />
        <div className="container">
          <div className="card empty">
            <h2>{error}</h2>
            <a href="/">返回首页</a>
          </div>
        </div>
      </>
    )
  }
  if (!detail || !user) return <Topbar />

  return (
    <>
      <Topbar />
      <div className="layout">
        <aside className="sidebar">
          <h3>
            <a href={`/c/${detail.collection.id}`} style={{ color: 'inherit' }}>
              {detail.collection.name}
            </a>
            {hasRole(user, 'contributor') && (
              <button className="tree-add visible" title="新建顶级文档" onClick={() => addChild(null)}>
                +
              </button>
            )}
          </h3>
          <DocTree
            docs={tree}
            activeId={id}
            canAdd={(d) => hasRole(user, 'contributor') && (!d.locked || user.role === 'admin')}
            canMove={(d) => canEditDoc(user, d)}
            onOpen={(nid) => navigate({ to: '/edit/$id', params: { id: nid } })}
            onAddChild={addChild}
            onChanged={refreshTree}
          />
        </aside>
        <main className="main">
          <div className="article">
            <nav className="crumbs">
              <a href={`/c/${detail.collection.id}`}>{detail.collection.name}</a>
              {detail.breadcrumbs.map((b) => (
                <span key={b.id}>
                  <span>/ </span>
                  <a href={`/edit/${b.id}`}>{b.title || '无标题'}</a>
                </span>
              ))}
            </nav>
            <DocEditor
              key={id}
              detail={detail}
              user={user}
              panel={panel}
              setPanel={setPanel}
              onMetaChange={() => {
                void load()
              }}
              onTitleSaved={refreshTree}
            />
          </div>
        </main>
      </div>
    </>
  )
}

/* ---------------- 编辑器主体 ---------------- */

function DocEditor(props: {
  detail: DocDetail
  user: User
  panel: 'none' | 'history' | 'settings'
  setPanel(p: 'none' | 'history' | 'settings'): void
  onMetaChange(): void
  onTitleSaved(): void
}) {
  const { detail, user } = props
  const doc = detail.doc
  const [collab, setCollab] = useState<{ ydoc: Y.Doc; provider: WebsocketProvider } | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([])

  useEffect(() => {
    const ydoc = new Y.Doc()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const provider = new WebsocketProvider(`${proto}//${location.host}/api/collab`, doc.id, ydoc)
    provider.on('status', ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) => setStatus(status))
    const onAwareness = () => {
      const list: { name: string; color: string }[] = []
      provider.awareness.getStates().forEach((s, cid) => {
        if (cid !== ydoc.clientID && s.user) list.push(s.user)
      })
      setPeers(list)
    }
    provider.awareness.on('change', onAwareness)
    setCollab({ ydoc, provider })
    return () => {
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      ydoc.destroy()
    }
  }, [doc.id])

  if (!collab) return null
  return <DocBody {...props} collab={collab} status={status} peers={peers} />
}

function DocBody(props: Parameters<typeof DocEditor>[0] & {
  collab: { ydoc: Y.Doc; provider: WebsocketProvider }
  status: string
  peers: { name: string; color: string }[]
}) {
  const { detail, user, collab } = props
  const doc = detail.doc
  const comments = useComments(doc.id, collab.provider)
  const [notesOpen, setNotesOpen] = useState(() => new URLSearchParams(location.search).has('comments'))
  const openCount = comments.data?.comments.filter((c) => c.anchor && !c.parentId && !c.resolved).length ?? 0

  // 批注面板与历史面板都在右侧，同时只显示一个
  const setPanel = (p: 'none' | 'history' | 'settings') => {
    if (p === 'history') setNotesOpen(false)
    props.setPanel(p)
  }
  const openNotes = (open: boolean) => {
    if (open && props.panel === 'history') props.setPanel('none')
    setNotesOpen(open)
  }

  return (
    <>
      <DocHeader {...props} setPanel={setPanel} notes={{ count: openCount, open: notesOpen, toggle: () => openNotes(!notesOpen) }} />
      <CollabEditor
        ydoc={collab.ydoc}
        provider={collab.provider}
        user={user}
        docId={doc.id}
        editable={detail.canEdit}
        comments={comments}
        notesOpen={notesOpen}
        setNotesOpen={openNotes}
      />
      {props.panel === 'history' && <HistoryPanel docId={doc.id} canEdit={detail.canEdit} onClose={() => props.setPanel('none')} />}
      <Discussion docId={doc.id} me={user} comments={comments} />
    </>
  )
}

function DocHeader(props: {
  detail: DocDetail
  user: User
  panel: 'none' | 'history' | 'settings'
  setPanel(p: 'none' | 'history' | 'settings'): void
  onMetaChange(): void
  onTitleSaved(): void
  status: string
  peers: { name: string; color: string }[]
  notes: { count: number; open: boolean; toggle(): void }
}) {
  const { detail, user } = props
  const doc = detail.doc
  const [title, setTitle] = useState(doc.title)
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveTitle = (t: string) => {
    setTitle(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await api(`/docs/${doc.id}`, { method: 'PATCH', body: { title: t } })
        props.onTitleSaved()
      } finally {
        setSaving(false)
      }
    }, 600)
  }

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/docs/${doc.id}`, { method: 'PATCH', body })
      props.onMetaChange()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const remove = async () => {
    if (!confirm(`确定删除「${doc.title || '无标题'}」？${user.role === 'admin' ? '子文档也会一并删除。' : ''}此操作不可撤销。`)) return
    try {
      await api(`/docs/${doc.id}`, { method: 'DELETE' })
      location.href = `/c/${doc.collectionId}`
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const statusText = { connecting: '连接中…', connected: '已同步', disconnected: '离线' }[props.status] ?? props.status

  return (
    <>
      <textarea
        className="title-input"
        rows={1}
        value={title}
        placeholder="无标题"
        readOnly={!detail.canEdit}
        maxLength={200}
        onChange={(e) => saveTitle(e.target.value.replace(/\n/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(document.querySelector('.ProseMirror') as HTMLElement | null)?.focus()
          }
        }}
        ref={(el) => {
          if (el) {
            el.style.height = 'auto'
            el.style.height = el.scrollHeight + 'px'
          }
        }}
      />
      <div className="doc-meta">
        <span className={`badge ${doc.effectiveVisibility}`} title={VIS_HINT[doc.effectiveVisibility]}>
          {VIS_LABEL[doc.effectiveVisibility]}
        </span>
        {doc.effectiveVisibility !== doc.visibility && (
          <span className="small muted" title="父文档的限制更严格，以父文档为准">
            （本文设为{VIS_LABEL[doc.visibility]}，受父文档限制）
          </span>
        )}
        {doc.locked && <span className="badge">已锁定</span>}
        {!detail.canEdit && <span className="badge">只读</span>}
        <span className={`sync ${props.status}`}>{saving ? '保存中…' : statusText}</span>
        <span className="peers">
          {props.peers.map((p, i) => (
            <span key={i} className="peer" style={{ background: p.color }} title={p.name}>
              {p.name.slice(0, 1)}
            </span>
          ))}
        </span>
        <span className="actions">
          <a className="btn btn-sm" href={`/d/${doc.id}`}>
            查看页面
          </a>
          <button className={`btn btn-sm${props.notes.open ? ' on' : ''}`} onClick={props.notes.toggle} title="选中正文文字即可添加批注">
            批注{props.notes.count > 0 && ` · ${props.notes.count}`}
          </button>
          <button className="btn btn-sm" onClick={() => props.setPanel(props.panel === 'history' ? 'none' : 'history')}>
            历史
          </button>
          <div className="menu-wrap">
            <button className="btn btn-sm" onClick={() => props.setPanel(props.panel === 'settings' ? 'none' : 'settings')}>
              ⋯
            </button>
            {props.panel === 'settings' && (
              <div className="menu" onMouseLeave={() => props.setPanel('none')}>
                <div className="menu-label">可见性</div>
                {(['public', 'protected', 'draft'] as Visibility[]).map((v) => (
                  <button
                    key={v}
                    className={`menu-item${doc.visibility === v ? ' on' : ''}`}
                    disabled={!detail.canEdit || ((v === 'draft' || doc.visibility === 'draft') && !detail.canDraft)}
                    onClick={() => patch({ visibility: v })}
                  >
                    <span>{VIS_LABEL[v]}</span>
                    <small>{VIS_HINT[v]}</small>
                  </button>
                ))}
                <div className="menu-sep" />
                {user.role === 'admin' && (
                  <button className="menu-item" onClick={() => patch({ locked: !doc.locked })}>
                    {doc.locked ? '解除锁定' : '锁定文档（仅管理员可编辑）'}
                  </button>
                )}
                <a className="menu-item" href={`/api/docs/${doc.id}/export.md`}>
                  导出 Markdown
                </a>
                {detail.canEdit && (
                  <button className="menu-item danger" onClick={remove}>
                    删除文档
                  </button>
                )}
                <div className="menu-sep" />
                <div className="menu-label small">
                  {doc.authorName} 创建 · {formatTime(doc.updatedAt)} 更新
                </div>
              </div>
            )}
          </div>
        </span>
      </div>
    </>
  )
}

async function uploadImage(docId: string, file: File): Promise<string | null> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('docId', docId)
  try {
    const { url } = await api<{ url: string }>('/uploads', { body: fd })
    return url
  } catch (e) {
    alert((e as Error).message)
    return null
  }
}

function CollabEditor({
  ydoc,
  provider,
  user,
  docId,
  editable,
  comments,
  notesOpen,
  setNotesOpen,
}: {
  ydoc: Y.Doc
  provider: WebsocketProvider
  user: User
  docId: string
  editable: boolean
  comments: CommentsApi
  notesOpen: boolean
  setNotesOpen(open: boolean): void
}) {
  const editorRef = useRef<Editor | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingNote | null>(null)
  // 编辑器扩展只创建一次，通过 ref 拿到最新的回调
  const activateRef = useRef<(id: string) => void>(() => {})
  activateRef.current = (id) => {
    setActive(id)
    setNotesOpen(true)
  }
  const insertFiles = (files: File[], pos?: number) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return false
    void (async () => {
      for (const f of images) {
        const url = await uploadImage(docId, f)
        const ed = editorRef.current
        if (!url || !ed) continue
        const c = ed.chain().focus()
        ;(pos !== undefined ? c.insertContentAt(pos, { type: 'image', attrs: { src: url, alt: f.name } }) : c.setImage({ src: url, alt: f.name })).run()
      }
    })()
    return true
  }

  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: '开始写作…（支持 Markdown 快捷输入，如 # 标题、- 列表、``` 代码块）' }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCaret.configure({ provider, user: { name: user.name, color: colorFor(user.id) } }),
        CommentAnchors.configure({ onActivate: (id) => activateRef.current(id) }),
      ],
      editorProps: {
        attributes: { class: 'prose editor' },
        handlePaste: (_view, event) => insertFiles([...(event.clipboardData?.files ?? [])]),
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])]
          if (!files.length) return false
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          return insertFiles(files, pos)
        },
      },
    },
    [ydoc, provider],
  )
  editorRef.current = editor
  useAnchorSync(editor, comments.data, pending, active)
  const sel = useSelectionRange(editor)

  if (!editor) return null
  const startNote = () => {
    if (!sel) return
    const anchor = makeAnchor(editor.state, sel.from, sel.to)
    if (!anchor) return
    setPending({ anchor, quote: editor.state.doc.textBetween(sel.from, sel.to, ' ').slice(0, 500) })
    setActive(null)
    setNotesOpen(true)
    window.getSelection()?.removeAllRanges()
  }
  return (
    <>
      {editable && <Toolbar editor={editor} onUpload={(f) => uploadImage(docId, f)} />}
      <EditorContent editor={editor} />
      {sel && !pending && <NoteButton top={sel.top} left={sel.left} onClick={startNote} />}
      {notesOpen && (
        <NotesPanel
          editor={editor}
          docId={docId}
          me={user}
          comments={comments}
          pending={pending}
          onPendingDone={() => setPending(null)}
          active={active}
          setActive={setActive}
          onClose={() => {
            setNotesOpen(false)
            setPending(null)
            setActive(null)
          }}
        />
      )}
    </>
  )
}

/* ---------------- 版本历史 ---------------- */

interface Revision {
  id: string
  title: string
  createdAt: number
  createdByName: string | null
}

function HistoryPanel({ docId, canEdit, onClose }: { docId: string; canEdit: boolean; onClose(): void }) {
  const [list, setList] = useState<Revision[] | null>(null)
  const [preview, setPreview] = useState<{ id: string; html: string; title: string } | null>(null)

  useEffect(() => {
    api<{ revisions: Revision[] }>(`/docs/${docId}/revisions`).then((r) => setList(r.revisions))
  }, [docId])

  const open = async (id: string) => {
    const r = await api<{ html: string; title: string }>(`/docs/${docId}/revisions/${id}`)
    setPreview({ id, ...r })
  }

  const restore = async () => {
    if (!preview || !confirm('用此版本覆盖当前内容？（当前内容仍会保留在历史中）')) return
    try {
      await api(`/docs/${docId}/revisions/${preview.id}/restore`, { method: 'POST' })
      onClose()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="drawer">
      <div className="drawer-head">
        <strong>版本历史</strong>
        <button className="btn btn-sm" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="muted small">编辑时每 10 分钟自动保存一个快照。</p>
      {!list && <p className="muted">加载中…</p>}
      {list?.length === 0 && <p className="muted">暂无历史版本</p>}
      <ul className="list">
        {list?.map((r) => (
          <li key={r.id}>
            <button className={`link rev${preview?.id === r.id ? ' on' : ''}`} onClick={() => open(r.id)}>
              {formatTime(r.createdAt)}
            </button>
            <div className="muted small">{r.createdByName ?? '未知'}</div>
          </li>
        ))}
      </ul>
      {preview && (
        <div className="rev-preview">
          <div className="drawer-head">
            <strong>{preview.title || '无标题'}</strong>
            {canEdit && (
              <button className="btn btn-sm btn-primary" onClick={restore}>
                恢复此版本
              </button>
            )}
          </div>
          <div className="prose" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}
    </div>
  )
}
