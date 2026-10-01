import { useEffect, useState } from 'react'
import { VIS_LABEL, api, formatTime, type Collection, type Role, type Visibility } from '../api'
import { Topbar } from '../components/Topbar'
import { useSession } from '../session'

interface AdminUser {
  id: string
  email: string
  name: string
  role: Role
  disabled: number
  createdAt: number
}

export function AdminPage() {
  const { user, loading } = useSession()
  const [tab, setTab] = useState<'rules' | 'users' | 'collections'>('rules')

  if (loading) return <Topbar />
  if (!user || user.role !== 'admin') {
    return (
      <>
        <Topbar />
        <div className="container">
          <div className="card empty">需要管理员权限</div>
        </div>
      </>
    )
  }
  return (
    <>
      <Topbar />
      <main className="container">
        <h1 style={{ fontSize: 22 }}>管理</h1>
        <div className="tabs">
          {(
            [
              ['rules', '注册白名单'],
              ['users', '用户'],
              ['collections', '集合'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'rules' && <Rules />}
        {tab === 'users' && <Users selfId={user.id} />}
        {tab === 'collections' && <Collections />}
      </main>
    </>
  )
}

function Rules() {
  const [rules, setRules] = useState<{ env: string[]; db: string[] } | null>(null)
  const [pattern, setPattern] = useState('')
  const [error, setError] = useState('')
  const load = () => api('/admin/email-rules').then(setRules)
  useEffect(() => void load(), [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/admin/email-rules', { body: { pattern } })
      setPattern('')
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section>
      <p className="muted small">
        只有命中以下任一规则的邮箱才能注册，其余一律拒绝。写法：<code>*.edu.cn</code>（任意子域）、<code>@pku.edu.cn</code>
        （精确域名）、<code>someone@gmail.com</code>（单个邮箱）。
      </p>
      <form className="row-form" onSubmit={add}>
        <input className="input" placeholder="*.edu.cn" value={pattern} onChange={(e) => setPattern(e.target.value)} required />
        <button className="btn btn-primary">添加</button>
      </form>
      {error && <div className="form-error">{error}</div>}
      <ul className="list">
        {rules?.env.map((r) => (
          <li key={'env' + r} className="row-between">
            <code>{r}</code>
            <span className="muted small">来自环境变量 ALLOWED_EMAIL_DOMAINS</span>
          </li>
        ))}
        {rules?.db.map((r) => (
          <li key={r} className="row-between">
            <code>{r}</code>
            <button
              className="btn btn-sm btn-danger"
              onClick={async () => {
                await api(`/admin/email-rules?pattern=${encodeURIComponent(r)}`, { method: 'DELETE' })
                void load()
              }}
            >
              删除
            </button>
          </li>
        ))}
        {rules && !rules.env.length && !rules.db.length && <li className="muted">暂无规则——当前任何邮箱都无法注册。</li>}
      </ul>
    </section>
  )
}

function Users({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const load = () => api<{ users: AdminUser[] }>('/admin/users').then((r) => setUsers(r.users))
  useEffect(() => void load(), [])
  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body })
      void load()
    } catch (e) {
      alert((e as Error).message)
    }
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>昵称</th>
          <th>邮箱</th>
          <th>注册时间</th>
          <th>角色</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {users?.map((u) => (
          <tr key={u.id}>
            <td>{u.name}</td>
            <td>{u.email}</td>
            <td className="muted small">{formatTime(u.createdAt)}</td>
            <td>
              <select className="input input-sm" value={u.role} disabled={u.id === selfId} onChange={(e) => patch(u.id, { role: e.target.value })}>
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
            </td>
            <td>
              <button className="btn btn-sm" disabled={u.id === selfId} onClick={() => patch(u.id, { disabled: !u.disabled })}>
                {u.disabled ? '已停用 · 启用' : '正常 · 停用'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Collections() {
  const [list, setList] = useState<Collection[] | null>(null)
  const load = () => api<{ collections: Collection[] }>('/collections').then((r) => setList(r.collections))
  useEffect(() => void load(), [])
  const patch = async (id: string, body: Record<string, unknown>) => {
    await api(`/collections/${id}`, { method: 'PATCH', body })
    void load()
  }
  return (
    <ul className="list">
      {list?.map((c) => (
        <li key={c.id} className="row-between">
          <div style={{ flex: 1 }}>
            <a href={`/c/${c.id}`}>
              <strong>{c.name}</strong>
            </a>
            <div className="muted small">{c.description || '无描述'}</div>
          </div>
          <label className="small muted">
            新文档默认{' '}
            <select className="input input-sm" value={c.defaultVisibility} onChange={(e) => patch(c.id, { defaultVisibility: e.target.value })}>
              {(['public', 'protected'] as Visibility[]).map((v) => (
                <option key={v} value={v}>
                  {VIS_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-sm"
            onClick={() => {
              const name = prompt('集合名称', c.name)
              if (name) void patch(c.id, { name })
            }}
          >
            重命名
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (!confirm(`删除集合「${c.name}」及其中所有文档？此操作不可撤销。`)) return
              await api(`/collections/${c.id}`, { method: 'DELETE' })
              void load()
            }}
          >
            删除
          </button>
        </li>
      ))}
      {list?.length === 0 && <li className="muted">暂无集合</li>}
    </ul>
  )
}
