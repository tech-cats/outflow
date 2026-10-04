import type { Config } from '../config'
import type { MailMessage, Mailer } from '../types'

/** 解析 "Name <addr@x.com>" */
export function parseAddress(s: string): { name?: string; email: string } {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return m ? { name: m[1] || undefined, email: m[2] } : { email: s.trim() }
}

export function consoleMailer(): Mailer {
  return {
    async send(msg: MailMessage) {
      console.log(`\n[mail:console] to=${msg.to}\n  subject: ${msg.subject}\n  ${msg.text}\n`)
    },
  }
}

export function resendMailer(cfg: Config): Mailer {
  return {
    async send(msg: MailMessage) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.mail.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: cfg.mail.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      })
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`)
    },
  }
}

export function pickMailer(cfg: Config, smtp: (cfg: Config) => Mailer): Mailer {
  switch (cfg.mail.driver) {
    case 'smtp':
      return smtp(cfg)
    case 'resend':
      return resendMailer(cfg)
    case 'console':
      return consoleMailer()
    case 'cloudflare':
      return {
        async send() {
          throw new Error('MAIL_DRIVER=cloudflare 只能在 Cloudflare Workers 上使用')
        },
      }
    default:
      return {
        async send() {
          throw new Error('mail not configured')
        },
      }
  }
}
