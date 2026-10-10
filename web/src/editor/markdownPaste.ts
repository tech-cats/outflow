import { marked } from 'marked'

/**
 * 粘贴 Markdown：剪贴板里是 Markdown 纯文本时转成富文本。
 * 从网页复制的内容自带 HTML（标题、列表等），交给编辑器默认处理；
 * 从代码编辑器、终端复制的内容只有纯文本或只带着色的 HTML，这时才按 Markdown 解析。
 */

const MD_HINTS = [
  /^#{1,6}\s+\S/m, // 标题
  /^\s*[-*+]\s+\S/m, // 无序列表
  /^\s*\d+[.)]\s+\S/m, // 有序列表
  /^\s*>\s?\S/m, // 引用
  /^```/m, // 代码块
  /^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m, // 表格
  /\[[^\]]+\]\([^)\s]+\)/, // 链接
  /\*\*[^*\n]+\*\*/, // 加粗
  /^(\s*[-*_]){3,}\s*$/m, // 分割线
]

/** 带语义标签的 HTML 说明来源是网页或文档，保留原格式 */
const SEMANTIC_HTML = /<(h[1-6]|ul|ol|li|table|strong|b|em|i|a|img|blockquote|p)[\s>]/i

export function markdownToPaste(text: string, html: string): string | null {
  if (!text.trim() || (html && SEMANTIC_HTML.test(html))) return null
  if (!MD_HINTS.some((re) => re.test(text))) return null
  const out = marked.parse(text, { gfm: true, breaks: false, async: false })
  const doc = new DOMParser().parseFromString(out, 'text/html')
  // GFM 任务列表 → 编辑器的任务列表结构
  for (const li of doc.querySelectorAll('li')) {
    const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]')
    if (!box) continue
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String((box as HTMLInputElement).checked))
    const next = box.nextSibling
    box.remove()
    if (next?.nodeType === Node.TEXT_NODE) next.textContent = next.textContent!.replace(/^\s+/, '')
    li.parentElement?.setAttribute('data-type', 'taskList')
  }
  // marked 会在代码末尾多留一个换行
  for (const code of doc.querySelectorAll('pre > code')) code.textContent = code.textContent!.replace(/\n$/, '')
  return doc.body.innerHTML
}
