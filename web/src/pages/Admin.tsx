import { useEffect, useState } from 'react'
import { ROLES, ROLE_LABEL, VIS_LABEL, api, formatTime, type Collection, type GeoScope, type Role, type Visibility } from '../api'
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
  const [tab, setTab] = useState<'site' | 'rules' | 'geo' | 'users' | 'collections'>('site')

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
              ['site', '站点'],
              ['rules', '注册白名单'],
              ['geo', '地域限制'],
              ['users', '用户'],
              ['collections', '集合'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'site' && <Site />}
        {tab === 'rules' && <Rules />}
        {tab === 'users' && <Users selfId={user.id} />}
        {tab === 'collections' && <Collections />}
        {tab === 'geo' && <Geo />}
      </main>
    </>
  )
}

function Site() {
  const [info, setInfo] = useState<{ home: { title: string; visibility: Visibility } | null } | null>(null)
  const [error, setError] = useState('')
  const load = () => api<NonNullable<typeof info>>('/admin/site').then(setInfo)
  useEffect(() => void load(), [])
  const create = async () => {
    setError('')
    try {
      await api('/admin/site/home', { method: 'POST' })
      location.href = '/edit/index'
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!info) return null
  return (
    <section>
      <h3 style={{ fontSize: 16 }}>首页</h3>
      <p className="muted small">
        首页文档是一篇固定的文档，显示在网站首页，适合放最常用的信息和链接。它不出现在集合的文档树中。没有首页文档、或访客无权阅读它时，首页显示集合列表；集合列表始终可以在
        <a href="/c">「全部文档」</a>中找到。
      </p>
      {info.home ? (
        <p className="row-form">
          <span>
            {info.home.title || '无标题'} <span className="muted small">（{VIS_LABEL[info.home.visibility]}）</span>
          </span>
          <a className="btn btn-sm" href="/">
            查看
          </a>
          <a className="btn btn-primary btn-sm" href="/edit/index">
            编辑
          </a>
        </p>
      ) : (
        <button className="btn btn-primary" onClick={create}>
          创建首页文档
        </button>
      )}
      {error && <div className="form-error">{error}</div>}
      <MailTemplateEditor />
    </section>
  )
}

interface MailTemplateInfo {
  subject: string
  body: string
  custom: boolean
  placeholders: Record<string, string>
  limits: { subject: number; body: number }
}

function MailTemplateEditor() {
  const [info, setInfo] = useState<MailTemplateInfo | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<{ subject: string; html: string; error: string | null } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const t = await api<MailTemplateInfo>('/admin/mail-template')
    setInfo(t)
    setSubject(t.subject)
    setBody(t.body)
  }
  useEffect(() => void load(), [])

  // 预览由服务端用示例数据渲染，与实际发出的邮件一致
  useEffect(() => {
    if (!info) return
    const t = setTimeout(() => {
      api<{ subject: string; html: string; error: string | null }>('/admin/mail-template/preview', { method: 'POST', body: { subject, body } })
        .then(setPreview)
        .catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [info, subject, body])

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setMsg(null)
    try {
      setMsg({ ok: true, text: await fn() })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!info) return null
  const dirty = subject !== info.subject || body !== info.body
  return (
    <>
      <h3 style={{ fontSize: 16, marginTop: 32 }}>验证码邮件</h3>
      <p className="muted small">
        注册和重置密码时发送。可用占位符：
        {Object.entries(info.placeholders).map(([k, label], i) => (
          <span key={k}>
            {i > 0 && '、'}
            <code>{`{${k}}`}</code> {label}
          </span>
        ))}
        。正文每行一段，单独一行的 <code>{'{code}'}</code> 会以大号字显示；正文必须包含 <code>{'{code}'}</code>。
      </p>
      <form
        className="mail-tpl"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await api('/admin/mail-template', { method: 'PUT', body: { subject, body } })
            await load()
            return '已保存'
          })
        }}
      >
        <label className="field">
          <span>标题</span>
          <input className="input" value={subject} maxLength={info.limits.subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label className="field">
          <span>正文</span>
          <textarea className="input" rows={6} value={body} maxLength={info.limits.body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        {preview && (
          <div className="mail-preview">
            <div className="muted small">预览（示例验证码 123456）</div>
            <strong>{preview.subject}</strong>
            <div dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        )}
        {preview?.error && <div className="form-error">{preview.error}</div>}
        <div className="row-form">
          <button className="btn btn-primary" disabled={busy || !dirty || !!preview?.error}>
            保存
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !!preview?.error}
            title="用当前编辑的内容发一封测试邮件到你的邮箱，可用来检查发信配置"
            onClick={() =>
              run(async () => {
                const r = await api<{ to: string }>('/admin/mail-template/test', { method: 'POST', body: { subject, body } })
                return `测试邮件已发送到 ${r.to}`
              })
            }
          >
            发送测试邮件
          </button>
          {info.custom && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                confirm('恢复默认的邮件模板？') &&
                run(async () => {
                  await api('/admin/mail-template', { method: 'PUT', body: { reset: true } })
                  await load()
                  return '已恢复默认模板'
                })
              }
            >
              恢复默认
            </button>
          )}
        </div>
        {msg && <div className={msg.ok ? 'muted small' : 'form-error'}>{msg.text}</div>}
      </form>
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
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
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

interface GeoInfo {
  scopes: Record<GeoScope, string>
  rules: Record<GeoScope, { countries: string[]; source: 'env' | 'admin' }>
  defaults: Record<GeoScope, string[]>
  unknown: 'allow' | 'deny'
  yourCountry: string | null
}

function Geo() {
  const [info, setInfo] = useState<GeoInfo | null>(null)
  const load = () => api<GeoInfo>('/admin/geo').then(setInfo)
  useEffect(() => void load(), [])
  if (!info) return null
  return (
    <section>
      <p className="muted small">
        按请求来源的国家/地区限制接口（ISO 两位代码，如 <code>CN</code>、<code>HK</code>、<code>MO</code>、<code>TW</code>），留空表示不限制。
        你当前的地区：<strong>{info.yourCountry ?? '未知'}</strong>；无法识别地区时：
        <strong>{info.unknown === 'allow' ? '放行' : '拒绝'}</strong>（环境变量 GEO_UNKNOWN）。
      </p>
      <ul className="list">
        {(Object.keys(info.scopes) as GeoScope[]).map((s) => (
          <GeoRow key={s} scope={s} label={info.scopes[s]} rule={info.rules[s]} defaults={info.defaults[s]} onSaved={load} />
        ))}
      </ul>
    </section>
  )
}

function GeoRow(props: {
  scope: GeoScope
  label: string
  rule: { countries: string[]; source: 'env' | 'admin' }
  defaults: string[]
  onSaved(): void
}) {
  const [value, setValue] = useState(props.rule.countries.join(', '))
  const [error, setError] = useState('')
  useEffect(() => setValue(props.rule.countries.join(', ')), [props.rule])
  const save = async (countries: string | null) => {
    setError('')
    try {
      await api(`/admin/geo/${props.scope}`, { method: 'PUT', body: { countries } })
      props.onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <li>
      <div className="row-between">
        <strong>{props.label}</strong>
        <span className="muted small">
          {props.rule.source === 'admin' ? '已在后台修改' : '使用环境变量默认值'}
          {props.rule.countries.length ? '' : ' · 当前不限制'}
        </span>
      </div>
      <form
        className="row-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save(value)
        }}
      >
        <input className="input" placeholder="留空 = 不限制，例如 CN, HK" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-primary">保存</button>
        {props.rule.source === 'admin' && (
          <button type="button" className="btn" title={`默认：${props.defaults.join(', ') || '不限制'}`} onClick={() => save(null)}>
            恢复默认
          </button>
        )}
      </form>
      {error && <div className="form-error">{error}</div>}
    </li>
  )
}
