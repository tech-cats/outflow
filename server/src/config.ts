export type CaptchaProvider = 'altcha' | 'turnstile' | 'hcaptcha' | 'none'
/** none：未配置任何邮件服务，发送验证码会直接报错，避免“看似成功却收不到邮件” */
export type MailDriver = 'smtp' | 'resend' | 'console' | 'none'
export type GeoScope = 'register' | 'login'

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
  geo: {
    /** 各范围的国家/地区白名单（ISO 3166-1 alpha-2）；空数组 = 不限制。管理后台可覆盖 */
    defaults: Record<GeoScope, string[]>
    /** 无法识别地区时：deny（默认）或 allow */
    unknown: 'allow' | 'deny'
    /** 仅 Node：信任的上游国家请求头（如 CF-IPCountry）；只有在代理会覆盖该头时才可设置 */
    header: string
    /** 仅 Node：本地 IP 库（MMDB 格式，如 DB-IP Lite / GeoLite2 Country） */
    mmdbPath: string
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
      // 未显式指定时自动选择；什么都没配置则为 none，绝不静默回退到 console
      driver: (s('MAIL_DRIVER') ||
        (s('SMTP_HOST') ? 'smtp' : s('RESEND_API_KEY') ? 'resend' : 'none')) as MailDriver,
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
    geo: {
      defaults: {
        register: parseCountries(s('GEO_REGISTER_COUNTRIES')),
        login: parseCountries(s('GEO_LOGIN_COUNTRIES')),
      },
      unknown: s('GEO_UNKNOWN', 'deny') === 'allow' ? 'allow' : 'deny',
      header: s('GEO_COUNTRY_HEADER'),
      mmdbPath: s('GEO_MMDB_PATH'),
    },
    maxUploadBytes: Number(s('MAX_UPLOAD_MB', '10')) * 1024 * 1024,
    secureCookies: appUrl ? appUrl.startsWith('https://') : s('SECURE_COOKIES', 'false') === 'true',
  }
}

/** "CN, hk" -> ["CN", "HK"]，忽略非法项 */
export function parseCountries(v: string): string[] {
  return [...new Set(v.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9]$/.test(x)))]
}
