import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '../api'
import { Captcha } from '../components/Captcha'
import { useSession } from '../session'
import { toggleTheme } from '../theme'

function safeNext(): string {
  const n = new URLSearchParams(location.search).get('next')
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'
}

function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { config } = useSession()
  return (
    <div className="auth-wrap">
      <a className="brand auth-brand" href="/">
        <span className="brand-mark" />
        {config?.appName ?? 'Outflow'}
      </a>
      <div className="card auth-card">
        <h1>{title}</h1>
        {children}
      </div>
      {footer && <div className="auth-footer">{footer}</div>}
      <button className="theme-toggle" style={{ marginTop: 12 }} title="切换深色/浅色" aria-label="切换深色/浅色" onClick={toggleTheme}>
        ◐
      </button>
    </div>
  )
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" {...rest} />
    </label>
  )
}

/* ---------------- 登录 ---------------- */

export function LoginPage() {
  const { config } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failedEnough, setNeedCaptcha] = useState(false)
  const needCaptcha = failedEnough || config?.loginCaptcha === 'always'
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/auth/login', { body: { email, password, captcha } })
      location.href = safeNext()
    } catch (err) {
      const e = err as ApiError
      setError(e.message)
      if (e.data?.captcha) {
        setNeedCaptcha(true)
        setCaptcha(null)
        setCaptchaKey((k) => k + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="登录"
      footer={
        <>
          还没有账号？<a href="/register">注册</a> · <a href="/reset">忘记密码</a>
        </>
      }
    >
      <form onSubmit={submit} className="form">
        <Field label="邮箱" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="密码"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {needCaptcha && config && <Captcha key={captchaKey} config={config.captcha} onToken={setCaptcha} />}
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || (needCaptcha && config?.captcha.provider !== 'none' && !captcha)}>
          {busy ? '登录中…' : needCaptcha && config?.captcha.provider !== 'none' && !captcha ? '安全验证中…' : '登录'}
        </button>
      </form>
    </AuthCard>
  )
}

/* ---------------- 注册 / 重置密码（共用“邮箱验证码”流程） ---------------- */

function CodeFlow({ purpose }: { purpose: 'register' | 'reset' }) {
  const { config } = useSession()
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const needsCaptcha = config?.captcha.provider !== 'none'

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/auth/send-code', { body: { email, purpose, captcha } })
      setStep(2)
      setCooldown(60)
      setInfo(`验证码已发送至 ${email}，10 分钟内有效`)
    } catch (err) {
      const e = err as ApiError
      setError(e.message)
      if (typeof e.data?.retryAfter === 'number') setCooldown(e.data.retryAfter)
    } finally {
      // 每个验证码 token 只能用一次
      setCaptcha(null)
      setCaptchaKey((k) => k + 1)
      setBusy(false)
    }
  }

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (purpose === 'register') {
        await api('/auth/register', { body: { email, code, name, password } })
      } else {
        await api('/auth/reset', { body: { email, code, password } })
      }
      location.href = safeNext()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (purpose === 'register' && config && !config.registrationEnabled) {
    return <p className="muted">当前未开放注册，请联系管理员。</p>
  }

  if (step === 1) {
    return (
      <form onSubmit={sendCode} className="form">
        <Field label="邮箱" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {purpose === 'register' && <p className="muted small" style={{ margin: 0 }}>仅允许白名单内的邮箱（如学校邮箱）注册。</p>}
        {config && <Captcha key={captchaKey} config={config.captcha} onToken={setCaptcha} />}
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || cooldown > 0 || (needsCaptcha && !captcha)}>
          {busy ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后可重发` : needsCaptcha && !captcha ? '安全验证中…' : '发送验证码'}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={finish} className="form">
      {info && <div className="form-info">{info}</div>}
      <Field
        label="邮箱验证码"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      {purpose === 'register' && (
        <Field label="昵称" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      )}
      <Field
        label={purpose === 'register' ? '密码（至少 8 位）' : '新密码（至少 8 位）'}
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="form-error">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? '提交中…' : purpose === 'register' ? '完成注册' : '重置密码'}
      </button>
      <button
        type="button"
        className="link small"
        onClick={() => {
          setStep(1)
          setError('')
        }}
      >
        {cooldown > 0 ? `没收到？${cooldown} 秒后可返回重新发送` : '没收到？返回重新发送'}
      </button>
    </form>
  )
}

export function RegisterPage() {
  return (
    <AuthCard title="注册" footer={<>已有账号？<a href="/login">登录</a></>}>
      <CodeFlow purpose="register" />
    </AuthCard>
  )
}

export function ResetPage() {
  return (
    <AuthCard title="重置密码" footer={<a href="/login">返回登录</a>}>
      <CodeFlow purpose="reset" />
    </AuthCard>
  )
}
