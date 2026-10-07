import { useRef, useState } from 'react'
import { ROLE_LABEL, api } from '../api'
import { Avatar } from '../components/Avatar'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

/** /account：个人设置（头像、昵称） */
export function AccountPage() {
  const { user, loading, setUser } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (loading) return <Topbar />
  if (!user) {
    location.href = '/login?next=/account'
    return null
  }

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await f()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const upload = (file: File) =>
    run(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const { avatar } = await api<{ avatar: string }>('/me/avatar', { method: 'PUT', body: fd })
      setUser({ ...user, avatar })
    })
  const saveName = (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(false)
    return run(async () => {
      const r = await api<{ user: typeof user }>('/me', { method: 'PATCH', body: { name: name ?? user.name } })
      setUser({ ...user, name: r.user.name })
      setName(null)
      setSaved(true)
    })
  }
  const remove = () =>
    run(async () => {
      await api('/me/avatar', { method: 'DELETE' })
      setUser({ ...user, avatar: null })
    })

  return (
    <>
      <Topbar />
      <main className="container">
        <h1 style={{ fontSize: 22 }}>个人设置</h1>
        {error && <div className="form-error">{error}</div>}
        <h3 style={{ fontSize: 16, marginTop: 24 }}>头像</h3>
        <div className="account-avatar">
          <Avatar id={user.id} name={user.name} src={user.avatar} size={72} />
          <div className="row-between" style={{ gap: 8 }}>
            <button className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {user.avatar ? '更换头像' : '上传头像'}
            </button>
            {user.avatar && (
              <button className="btn btn-sm" disabled={busy} onClick={remove}>
                恢复默认
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
        </div>
        <p className="muted small">建议使用正方形图片。没有上传时显示昵称的第一个字。</p>
        <h3 style={{ fontSize: 16, marginTop: 32 }}>昵称</h3>
        <form className="row-between" style={{ gap: 8, maxWidth: 420 }} onSubmit={saveName}>
          <input
            className="input"
            style={{ flex: 1 }}
            required
            maxLength={40}
            value={name ?? user.name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
          />
          <button className="btn btn-primary" disabled={busy || name === null || !name.trim() || name.trim() === user.name}>
            保存
          </button>
        </form>
        <p className="muted small">{saved ? '已保存。' : '昵称显示在文档、评论和 @ 提及中，最多 40 个字。'}</p>
        <h3 style={{ fontSize: 16, marginTop: 32 }}>账号</h3>
        <ul className="list small">
          <li>邮箱：{user.email}</li>
          <li>角色：{ROLE_LABEL[user.role]}</li>
        </ul>
      </main>
    </>
  )
}
