import { useEffect, useRef } from 'react'
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
 */
export function Captcha({ config, onToken }: { config: AppConfig['captcha']; onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const altchaRef = useRef<HTMLElement>(null)
  const cb = useRef(onToken)
  cb.current = onToken

  useEffect(() => {
    if (config.provider === 'altcha') {
      const el = altchaRef.current
      if (!el) return
      const handler = (e: Event) => {
        const d = (e as CustomEvent<{ state: string; payload?: string }>).detail
        cb.current(d.state === 'verified' ? (d.payload ?? null) : null)
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
      <altcha-widget
        ref={altchaRef}
        challenge="/api/captcha/challenge"
        language="zh-cn"
        configuration={JSON.stringify({ hideFooter: true, hideLogo: true })}
        style={{ display: 'block', maxWidth: '100%' }}
      />
    )
  }
  return <div ref={ref} />
}
