export type CaptchaProvider = 'altcha' | 'turnstile' | 'hcaptcha' | 'none'
export type MailDriver = 'smtp' | 'resend' | 'console'

export interface Config {
  appName: string
  appUrl: string
  sessionSecret: string
  allowedEmails: string[]
  registrationEnabled: boolean
  /** always：每次登录都要人机验证；after_failures：连续失败 3 次后才要求 */
  loginCaptcha: 'always' | 'after_failures'
  captcha: { provider: CaptchaProvider; siteKey: string; secret: string }
  mail: {
    driver: MailDriver
    from: string
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string }
    resendApiKey: string
  }
  maxUploadBytes: number
  /** 生产环境（https）下 Cookie 加 Secure */
  secureCookies: boolean
}

export function loadConfig(env: Record<string, unknown>): Config {
  const s = (k: string, d = '') => {
    const v = env[k]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : d
  }
  const secret = s('SESSION_SECRET')
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET 未设置或过短（至少 16 个字符）')
  }
  const appUrl = s('APP_URL').replace(/\/$/, '')
  return {
    appName: s('APP_NAME', 'Outflow'),
    appUrl,
    sessionSecret: secret,
    allowedEmails: s('ALLOWED_EMAIL_DOMAINS')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    registrationEnabled: s('REGISTRATION_ENABLED', 'true') !== 'false',
    loginCaptcha: s('LOGIN_CAPTCHA', 'always') === 'after_failures' ? 'after_failures' : 'always',
    captcha: {
      provider: s('CAPTCHA_PROVIDER', 'altcha') as CaptchaProvider,
      siteKey: s('CAPTCHA_SITE_KEY'),
      secret: s('CAPTCHA_SECRET'),
    },
    mail: {
      driver: s('MAIL_DRIVER', 'console') as MailDriver,
      from: s('MAIL_FROM', 'Outflow <noreply@example.com>'),
      smtp: {
        host: s('SMTP_HOST'),
        port: Number(s('SMTP_PORT', '465')),
        secure: s('SMTP_SECURE', 'true') !== 'false',
        user: s('SMTP_USER'),
        pass: s('SMTP_PASS'),
      },
      resendApiKey: s('RESEND_API_KEY'),
    },
    maxUploadBytes: Number(s('MAX_UPLOAD_MB', '10')) * 1024 * 1024,
    secureCookies: appUrl ? appUrl.startsWith('https://') : s('SECURE_COOKIES', 'false') === 'true',
  }
}
