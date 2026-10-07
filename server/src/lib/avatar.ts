/** 默认头像：用户名首字 + 按用户 id 生成的背景色。服务端页面和前端共用 */

export function avatarInitial(name: string | null | undefined): string {
  const first = [...(name ?? '').trim()][0]
  return first ? first.toUpperCase() : '?'
}

export function avatarColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 55% 50%)`
}

/** 只接受本站上传的图片，防止注入任意地址 */
export function avatarSrc(v: string | null | undefined): string | null {
  return v && /^\/uploads\/[a-z0-9]+$/.test(v) ? v : null
}
