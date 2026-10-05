import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '../api'
import { Captcha } from '../components/Captcha'
import { useSession } from '../session'
import { toggleTheme } from '../theme'
import { BrandMark } from '../components/BrandMark'

function safeNext(): string {
  const n = new URLSearchParams(location.search).get('next')
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'
}

const SCOPE_LABEL = { register: '注册', login: '登录' } as const

function AuthCard({
  title,
  children,
  footer,
  scope,
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  /** 地域白名单范围：当前地区被拒绝时直接给出提示，不渲染表单 */
  scope: 'register' | 'login'
}) {
  const { config } = useSession()
  const blocked = config?.geo.blocked.includes(scope)
  return (
    <div className="auth-wrap">
      <a className="auth-back" href="/">
        ← 返回首页
      </a>
      <a className="brand auth-brand" href="/">
        <BrandMark icon={config?.appIcon} />
        {config?.appName ?? 'Outflow'}
      </a>
      <div className="card auth-card">
        <h1>{title}</h1>
        {blocked ? (
          <div className="form-error">
            当前地区（{config?.geo.country ?? '未知'}）暂不开放{SCOPE_LABEL[scope]}。如有疑问请联系管理员。
          </div>
        ) : (
          children
        )}
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
      scope="login"
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

const STEPS = {
  register: ['验证邮箱', '输入验证码', '设置账号'],
  reset: ['验证邮箱', '输入验证码', '设置新密码'],
} as const

function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="stepper" aria-label={`第 ${current} 步，共 ${steps.length} 步`}>
      {steps.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'current' : 'todo'
        return (
          <li key={label} className={`step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot">{state === 'done' ? '✓' : n}</span>
            <span className="step-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 邮箱验证码三步流程（注册 / 重置密码共用）：
 *   1 验证邮箱 → 2 输入验证码（即时校验，不作废）→ 3 设置账号/新密码（最终提交时作废验证码）
 * 人机验证组件在整个流程中常驻，第 2 步的“重新发送”也能直接拿到 token。
 */
function CodeFlow({ purpose }: { purpose: 'register' | 'reset' }) {
  const { config } = useSession()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState('')
  /** 验证码已发送到的邮箱；回到第 1 步时据此允许直接继续输入，不必等冷却 */
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const needsCaptcha = config?.captcha.provider !== 'none'
  const normalized = email.trim().toLowerCase()
  const alreadySent = sentTo !== null && sentTo === normalized
  const go = (n: 1 | 2 | 3) => {
    setError('')
    setStep(n)
  }

  const sendCode = async () => {
    setError('')
    setBusy(true)
    try {
      await api('/auth/send-code', { body: { email: normalized, purpose, captcha } })
      setSentTo(normalized)
      setCode('')
      setCooldown(60)
      go(2)
    } catch (err) {
      const e = err as ApiError
      setError(e.message)
      if (typeof e.data?.retryAfter === 'number') setCooldown(e.data.retryAfter)
    } finally {
      // 每个人机验证 token 只能用一次，重新挂载组件以自动再做一次
      setCaptcha(null)
      setCaptchaKey((k) => k + 1)
      setBusy(false)
    }
  }

  const checkCode = async (value = code) => {
    if (value.length !== 6) return setError('请输入 6 位验证码')
    setError('')
    setBusy(true)
    try {
      await api('/auth/check-code', { body: { email: normalized, purpose, code: value } })
      go(3)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== password2) return setError('两次输入的密码不一致')
    setError('')
    setBusy(true)
    try {
      if (purpose === 'register') {
        await api('/auth/register', { body: { email: normalized, code, name, password } })
      } else {
        await api('/auth/reset', { body: { email: normalized, code, password } })
      }
      location.href = safeNext()
    } catch (err) {
      const msg = (err as Error).message
      // 验证码在两步之间过期或失效时，回到第 2 步重新获取
      if (msg.includes('验证码')) {
        setStep(2)
        setError(msg + '，请重新发送')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  if (purpose === 'register' && config && !config.registrationEnabled) {
    return <p className="muted">当前未开放注册，请联系管理员。</p>
  }

  const captchaPending = needsCaptcha && !captcha
  const resendLabel = cooldown > 0 ? `${cooldown} 秒后可重新发送` : captchaPending ? '安全验证中…' : '重新发送'

  return (
    <>
      <Stepper steps={STEPS[purpose]} current={step} />
      {config && <Captcha key={captchaKey} config={config.captcha} onToken={setCaptcha} />}

      {step === 1 && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (alreadySent && cooldown > 0) go(2)
            else void sendCode()
          }}
        >
          <Field label="邮箱" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {purpose === 'register' && <p className="muted small" style={{ margin: 0 }}>仅允许白名单内的邮箱（如学校邮箱）注册。</p>}
          {config && !config.mail.configured && (
            <div className="form-error">邮件服务尚未配置，暂时无法发送验证码，请联系管理员。</div>
          )}
          {error && <div className="form-error">{error}</div>}
          {alreadySent && cooldown > 0 ? (
            <button className="btn btn-primary">继续输入验证码</button>
          ) : (
            <button className="btn btn-primary" disabled={busy || cooldown > 0 || captchaPending}>
              {busy ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后可发送` : captchaPending ? '安全验证中…' : '发送验证码'}
            </button>
          )}
          {alreadySent && cooldown <= 0 && (
            <button type="button" className="link small" onClick={() => go(2)}>
              已收到验证码？继续输入 →
            </button>
          )}
        </form>
      )}

      {step === 2 && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void checkCode()
          }}
        >
          <div className="form-info">
            验证码已发送至 <strong>{sentTo}</strong>，10 分钟内有效。
          </div>
          {config?.mail.devConsole && (
            <div className="form-warn">开发模式（MAIL_DRIVER=console）：邮件不会真正发出，验证码打印在服务端日志中。</div>
          )}
          <Field
            label="邮箱验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            required
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '')
              setCode(v)
              // 输满 6 位自动校验
              if (v.length === 6 && !busy) void checkCode(v)
            }}
          />
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>
            {busy ? '校验中…' : '下一步'}
          </button>
          <div className="row-between small">
            <button type="button" className="link" onClick={() => go(1)}>
              ← 修改邮箱
            </button>
            <button type="button" className="link" disabled={busy || cooldown > 0 || captchaPending} onClick={() => void sendCode()}>
              {resendLabel}
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={finish} className="form">
          {purpose === 'register' && (
            <Field label="昵称" required autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <Field
            label={purpose === 'register' ? '密码（至少 8 位）' : '新密码（至少 8 位）'}
            type="password"
            autoComplete="new-password"
            autoFocus={purpose === 'reset'}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            label="确认密码"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
          />
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? '提交中…' : purpose === 'register' ? '完成注册' : '重置密码'}
          </button>
          <button type="button" className="link small" onClick={() => go(2)}>
            ← 上一步
          </button>
        </form>
      )}
    </>
  )
}

export function RegisterPage() {
  return (
    <AuthCard title="注册" scope="register" footer={<>已有账号？<a href="/login">登录</a></>}>
      <CodeFlow purpose="register" />
    </AuthCard>
  )
}

export function ResetPage() {
  return (
    <AuthCard title="重置密码" scope="login" footer={<a href="/login">返回登录</a>}>
      <CodeFlow purpose="reset" />
    </AuthCard>
  )
}
