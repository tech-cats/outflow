import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { ApiError, VIS_HINT, VIS_LABEL, api, createDoc, formatTime, hasRole, type DocMeta, type Topic, type User, type Visibility } from '../api'
import {
  CommentAnchors,
  Discussion,
  NoteButton,
  NotesPanel,
  makeAnchor,
  scrollToAnchor,
  useAnchorSync,
  useComments,
  useSelectionRange,
  type CommentsApi,
  type PendingNote,
} from '../components/Comments'
import { Avatar } from '../components/Avatar'
import { DocTree } from '../components/DocTree'
import { GuideCard, GuideCards } from '../editor/GuideCards'
import { markdownToPaste } from '../editor/markdownPaste'
import { docPanels } from '../plugins'
import { Toolbar } from '../components/Toolbar'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

/** 协作者（来自 awareness；旧版本客户端没有 id 和 avatar） */
interface Peer {
  id?: string
  name: string
  color: string
  avatar?: string | null
}

interface DocDetail {
  doc: DocMeta & { effectiveVisibility: Visibility; authorName: string | null; updatedByName: string | null }
  topic: { id: string; name: string } | null
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
  const [tree, setTree] = useState<{ topics: Topic[]; docs: DocMeta[] }>({ topics: [], docs: [] })
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'none' | 'history' | 'settings'>('none')

  const load = useCallback(async () => {
    try {
      const d = await api<DocDetail>(`/docs/${id}`)
      setDetail(d)
      setTree(await api<{ topics: Topic[]; docs: DocMeta[] }>('/tree'))
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
    setTree(await api<{ topics: Topic[]; docs: DocMeta[] }>('/tree'))
  }, [])

  const addDoc = async (at: { topicId?: string; parentId?: string }) => {
    try {
      const nid = await createDoc(at)
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
          <DocTree
            topics={tree.topics}
            docs={tree.docs}
            activeId={id}
            canAdd={(d) => hasRole(user, 'contributor') && (!d.locked || user.role === 'admin')}
            canMove={(d) => canEditDoc(user, d)}
            canAddTop={hasRole(user, 'contributor')}
            onOpen={(nid) => navigate({ to: '/edit/$id', params: { id: nid } })}
            onAdd={addDoc}
            onChanged={() => void load()}
          />
          {hasRole(user, 'editor') && (
            <button
              className="link small tree-new-topic"
              onClick={async () => {
                const name = prompt('新主题名称')?.trim()
                if (!name) return
                try {
                  await api('/topics', { body: { name } })
                  void refreshTree()
                } catch (e) {
                  alert((e as Error).message)
                }
              }}
            >
              + 新建主题
            </button>
          )}
        </aside>
        <main className="main">
          <div className="article">
            <nav className="crumbs">
              {detail.topic && <a href={`/c/${detail.topic.id}`}>{detail.topic.name}</a>}
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
              topics={tree.topics}
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
  topics: Topic[]
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
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    const ydoc = new Y.Doc()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const provider = new WebsocketProvider(`${proto}//${location.host}/api/collab`, doc.id, ydoc)
    provider.on('status', ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) => setStatus(status))
    const onAwareness = () => {
      const list: Peer[] = []
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
  peers: Peer[]
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
      {docPanels.map(({ id, Panel }) => (
        <Panel key={id} docId={doc.id} canEdit={detail.canEdit} user={user} />
      ))}
      <Discussion docId={doc.id} me={user} comments={comments} />
    </>
  )
}

function DocHeader(props: {
  detail: DocDetail
  topics: Topic[]
  user: User
  panel: 'none' | 'history' | 'settings'
  setPanel(p: 'none' | 'history' | 'settings'): void
  onMetaChange(): void
  onTitleSaved(): void
  status: string
  peers: Peer[]
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
      location.href = `/c/${doc.topicId}`
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
            <span key={i} className="peer" style={{ borderColor: p.color }} title={p.name}>
              <Avatar id={p.id ?? p.name} name={p.name} src={p.avatar} size={22} />
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
                {detail.canEdit && doc.id !== 'index' && props.topics.length > 1 && (
                  <>
                    <div className="menu-sep" />
                    <div className="menu-label">主题</div>
                    {props.topics.map((t) => (
                      <button
                        key={t.id}
                        className={`menu-item${doc.topicId === t.id ? ' on' : ''}`}
                        disabled={doc.topicId === t.id}
                        onClick={() => patch({ topicId: t.id })}
                      >
                        <span>{t.name}</span>
                      </button>
                    ))}
                    {doc.parentId && <div className="menu-label small">换主题后本文会变成该主题下的顶级文档</div>}
                  </>
                )}
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
        // 列宽拖动不开启：阅读页不保存列宽，两边显示保持一致
        TableKit.configure({ table: { resizable: false } }),
        GuideCards,
        GuideCard,
        Placeholder.configure({ placeholder: '开始写作…（支持 Markdown 快捷输入，如 # 标题、- 列表、``` 代码块）' }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCaret.configure({ provider, user: { id: user.id, name: user.name, color: colorFor(user.id), avatar: user.avatar ?? null } }),
        CommentAnchors.configure({ onActivate: (id) => activateRef.current(id) }),
      ],
      editorProps: {
        attributes: { class: 'prose editor' },
        handlePaste: (view, event) => {
          const data = event.clipboardData
          if (insertFiles([...(data?.files ?? [])])) return true
          // 代码块里保持原样粘贴
          if (!data || view.state.selection.$from.parent.type.spec.code) return false
          const html = markdownToPaste(data.getData('text/plain'), data.getData('text/html'))
          if (!html || !editorRef.current) return false
          editorRef.current.chain().focus().insertContent(html).run()
          return true
        },
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

  // 从通知跳转过来（?note=）：文档同步完成后定位到对应批注
  const initialNote = useRef(new URLSearchParams(location.search).get('note'))
  const [synced, setSynced] = useState(provider.synced)
  useEffect(() => {
    const on = (s: boolean) => setSynced(s)
    provider.on('sync', on)
    return () => provider.off('sync', on)
  }, [provider])
  useEffect(() => {
    const id = initialNote.current
    const target = id && comments.data?.comments.find((c) => c.id === id)
    if (!editor || !synced || !target) return
    initialNote.current = null
    setActive(target.id)
    setNotesOpen(true)
    if (target.anchor) setTimeout(() => !editor.isDestroyed && scrollToAnchor(editor, target.anchor!), 50)
  }, [editor, synced, comments.data])
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
