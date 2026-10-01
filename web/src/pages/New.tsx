import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { VIS_HINT, VIS_LABEL, api, createDoc, type Collection, type Visibility } from '../api'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

/** /new：选择集合后创建文档；带 ?collection= 时直接创建并跳转到编辑器 */
export function NewPage() {
  const { user, loading } = useSession()
  const navigate = useNavigate()
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [name, setName] = useState('')
  const [vis, setVis] = useState<Visibility>('public')
  const [error, setError] = useState('')
  const started = useRef(false)

  const go = async (collectionId: string, parentId: string | null = null) => {
    try {
      const id = await createDoc(collectionId, parentId)
      navigate({ to: '/edit/$id', params: { id }, replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (loading) return
    if (!user) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
      return
    }
    const q = new URLSearchParams(location.search)
    const col = q.get('collection')
    if (col && !started.current) {
      started.current = true
      void go(col, q.get('parent'))
      return
    }
    api<{ collections: Collection[] }>('/collections').then((r) => setCollections(r.collections))
  }, [loading, user])

  const createCollection = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const { id } = await api<{ id: string }>('/collections', { body: { name, defaultVisibility: vis } })
      await go(id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <Topbar />
      <main className="container" style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 22 }}>新建文档</h1>
        {error && <div className="form-error">{error}</div>}
        {collections && collections.length > 0 && (
          <>
            <p className="muted">选择要放入的集合：</p>
            <div className="pick-list">
              {collections.map((c) => (
                <button key={c.id} className="card pick" onClick={() => go(c.id)}>
                  <strong>{c.name}</strong>
                  {c.description && <span className="muted small">{c.description}</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {collections && (
          <form className="card form" style={{ marginTop: 24 }} onSubmit={createCollection}>
            <strong>{collections.length ? '或者新建一个集合' : '先创建一个集合'}</strong>
            <input className="input" placeholder="集合名称，如「课程笔记」" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="field">
              <span>新文档默认可见性</span>
              <select className="input" value={vis} onChange={(e) => setVis(e.target.value as Visibility)}>
                {(['public', 'protected'] as Visibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VIS_LABEL[v]} —— {VIS_HINT[v]}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary">创建集合并新建文档</button>
          </form>
        )}
      </main>
    </>
  )
}
