import { useEffect, useRef, useState } from 'react'
import 'altcha'
import 'altcha/i18n/zh-cn'
import type {} from 'altcha/types/react'
import type { AppConfig } from '../api'

declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, opts: Record<string, unknown>): string; remove(id: string): void }
    hcaptcha?: { render(el: HTMLElement, opts: Record<string, unknown>): string; remove?(id: string): void }
  }
}

const loaded = new Map<string, Promise<void>>()
function loadScript(src: string) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = src
        s.async = true
        s.onload = () => resolve()
        s.onerror = reject
        document.head.appendChild(s)
      }),
    )
  }
  return loaded.get(src)!
}

/**
 * 统一的人机验证组件；拿到 token 后通过 onToken 回调。
 * 需要重新验证（例如 token 已被使用）时，修改 key 让组件重新挂载即可。
 *
 * ALTCHA 为隐式模式：页面加载即在后台计算工作量证明，不显示勾选框，
 * 只在页面顶部弹出通知告知进度；失败可点击重试，过期自动重新验证。
 */
export function Captcha({ config, onToken }: { config: AppConfig['captcha']; onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const altchaRef = useRef<HTMLElement>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  const [state, setState] = useState<string>('verifying')
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    if (config.provider === 'altcha') {
      const el = altchaRef.current as (HTMLElement & { verify?: () => unknown }) | null
      if (!el) return
      const handler = (e: Event) => {
        const d = (e as CustomEvent<{ state: string; payload?: string }>).detail
        setState(d.state)
        cb.current(d.state === 'verified' ? (d.payload ?? null) : null)
        if (d.state === 'verified') setShowDone(true)
        // 题目过期（10 分钟）后自动重新验证
        if (d.state === 'expired') void el.verify?.()
      }
      el.addEventListener('statechange', handler)
      return () => el.removeEventListener('statechange', handler)
    }
    const host = ref.current
    if (!host) return
    let id: string | undefined
    let cancelled = false
    const opts = {
      sitekey: config.siteKey,
      callback: (t: string) => cb.current(t),
      'expired-callback': () => cb.current(null),
      'error-callback': () => cb.current(null),
    }
    if (config.provider === 'turnstile') {
      loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit').then(() => {
        if (!cancelled) id = window.turnstile!.render(host, opts)
      })
      return () => {
        cancelled = true
        if (id) window.turnstile?.remove(id)
      }
    }
    if (config.provider === 'hcaptcha') {
      loadScript('https://js.hcaptcha.com/1/api.js?render=explicit&hl=zh-CN').then(() => {
        if (!cancelled) id = window.hcaptcha!.render(host, opts)
      })
      return () => {
        cancelled = true
      }
    }
  }, [config.provider, config.siteKey])

  if (config.provider === 'none') return null
  if (config.provider === 'altcha') {
    return (
      <>
        <altcha-widget
          ref={altchaRef}
          challenge="/api/captcha/challenge"
          language="zh-cn"
          display="invisible"
          auto="onload"
          configuration={JSON.stringify({ hideFooter: true, hideLogo: true })}
        />
        <CaptchaToast
          state={state}
          showDone={showDone}
          onDoneHidden={() => setShowDone(false)}
          onRetry={() => void (altchaRef.current as (HTMLElement & { verify?: () => unknown }) | null)?.verify?.()}
        />
      </>
    )
  }
  return <div ref={ref} />
}

/** 本次页面加载是否已经提示过“验证通过”；之后的自动重新验证保持安静 */
let doneAnnounced = false

/**
 * 页面顶部的验证状态通知。为避免打扰：
 *  - “进行中”只在验证超过 600ms 时才出现
 *  - “通过”每次页面加载只提示一次
 *  - 失败始终提示，并可点击重试
 */
function CaptchaToast(props: { state: string; showDone: boolean; onDoneHidden(): void; onRetry(): void }) {
  const { state, showDone, onDoneHidden } = props
  const pending = state === 'verifying' || state === 'unverified' || state === 'expired'
  const [slow, setSlow] = useState(false)
  const [announce, setAnnounce] = useState(false)
  useEffect(() => {
    if (!pending) return setSlow(false)
    const t = setTimeout(() => setSlow(true), 600)
    return () => clearTimeout(t)
  }, [pending])
  useEffect(() => {
    if (!showDone) return
    if (!doneAnnounced) {
      doneAnnounced = true
      setAnnounce(true)
    }
    const t = setTimeout(() => {
      setAnnounce(false)
      onDoneHidden()
    }, 1800)
    return () => clearTimeout(t)
  }, [showDone, onDoneHidden])

  if (pending && slow) {
    return (
      <div className="toast" role="status">
        <span className="spinner" />
        正在进行安全验证…
      </div>
    )
  }
  if (state === 'error') {
    return (
      <button type="button" className="toast toast-error" onClick={props.onRetry}>
        安全验证失败，点击重试
      </button>
    )
  }
  if (state === 'verified' && announce) {
    return (
      <div className="toast toast-ok" role="status">
        ✓ 安全验证通过
      </div>
    )
  }
  return null
}
