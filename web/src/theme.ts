// 与 server/src/views/styles.ts 的 THEME_INIT_JS / THEME_TOGGLE_JS 使用同一个存储键
const KEY = 'outflow-theme'

/** 在浅色/深色之间切换（以当前实际生效的主题为准），并记住选择 */
export function toggleTheme() {
  const root = document.documentElement
  const current = root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const next = current === 'dark' ? 'light' : 'dark'
  root.dataset.theme = next
  try {
    localStorage.setItem(KEY, next)
  } catch {}
}
