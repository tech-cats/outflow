const enc = new TextEncoder()

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 短 ID（默认 12 位 base36，约 62 bit） */
export function newId(len = 12): string {
  const bytes = randomBytes(len)
  let out = ''
  for (const b of bytes) out += ID_ALPHABET[b % 36]
  return out
}

/** 均匀分布的 6 位数字验证码 */
export function randomDigits(n = 6): string {
  let out = ''
  while (out.length < n) {
    const b = randomBytes(1)[0]
    if (b < 250) out += String(b % 10)
  }
  return out
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function toBase64(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

export function base64url(u8: Uint8Array): string {
  return toBase64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(input)))
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// Workers 上 PBKDF2 迭代次数上限为 100000
const PBKDF2_ITER = 100_000

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await pbkdf2(password, salt, PBKDF2_ITER)
  return `pbkdf2$sha256$${PBKDF2_ITER}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , iter, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const hash = await pbkdf2(password, fromBase64(saltB64), Number(iter))
  return timingSafeEqual(toBase64(hash), hashB64)
}
