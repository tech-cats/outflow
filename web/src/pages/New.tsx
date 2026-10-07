import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { createDoc, hasRole } from '../api'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

/** /new：直接新建文档并进入编辑器，主题可以之后在编辑器里调整；?topic= 或 ?parent= 指定位置 */
export function NewPage() {
  const { user, loading } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (loading) return
    if (!user) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
      return
    }
    if (!hasRole(user, 'contributor') || started.current) return
    started.current = true
    const q = new URLSearchParams(location.search)
    createDoc({ topicId: q.get('topic'), parentId: q.get('parent') })
      .then((id) => navigate({ to: '/edit/$id', params: { id }, replace: true }))
      .catch((e: Error) => setError(e.message))
  }, [loading, user])

  return (
    <>
      <Topbar />
      <main className="container">
        {error && <div className="form-error">{error}</div>}
        {user && !hasRole(user, 'contributor') && (
          <div className="card empty">你目前只能阅读和评论。如需写文档，请联系管理员调整角色。</div>
        )}
        {!error && hasRole(user, 'contributor') && <p className="muted">正在新建文档…</p>}
      </main>
    </>
  )
}
