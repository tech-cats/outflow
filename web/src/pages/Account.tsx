import { useRef, useState } from 'react'
import { ROLE_LABEL, api } from '../api'
import { Avatar } from '../components/Avatar'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

/** /account：个人设置（目前只有头像） */
export function AccountPage() {
  const { user, loading, setUser } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
        <p className="muted small">建议使用正方形图片。没有上传时显示用户名的第一个字。</p>
        <h3 style={{ fontSize: 16, marginTop: 32 }}>账号</h3>
        <ul className="list small">
          <li>名字：{user.name}</li>
          <li>邮箱：{user.email}</li>
          <li>角色：{ROLE_LABEL[user.role]}</li>
        </ul>
      </main>
    </>
  )
}
