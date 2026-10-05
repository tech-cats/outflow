/** 顶栏站点图标：管理员上传了图标时显示图片，否则显示内置的渐变方块 */
export function BrandMark({ icon }: { icon?: string | null }) {
  return icon ? <img className="brand-icon" src={icon} alt="" /> : <span className="brand-mark" />
}
