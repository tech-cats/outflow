import { avatarColor, avatarInitial, avatarSrc } from '../../../server/src/lib/avatar'

/** 用户头像：没有上传时显示用户名首字（与服务端页面的 Avatar 一致） */
export function Avatar({ id, name, src, size }: { id: string; name: string | null; src?: string | null; size: number }) {
  const url = avatarSrc(src)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46) }
  return url ? (
    <img className="avatar" src={url} alt="" style={style} />
  ) : (
    <span className="avatar" style={{ ...style, background: avatarColor(id) }} aria-hidden="true">
      {avatarInitial(name)}
    </span>
  )
}
