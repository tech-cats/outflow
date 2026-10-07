import * as Y from 'yjs'
import type { PMMark, PMNode } from '../types'

/* ---------------- Yjs <-> ProseMirror JSON ---------------- */
// 结构与 y-prosemirror 一致：XmlElement.nodeName = 节点类型，属性 = attrs，
// XmlText 的 delta attributes = marks（同类 mark 可能带 "--hash" 后缀）

export const FRAGMENT = 'default'

export function yDocToJSON(doc: Y.Doc): PMNode {
  const frag = doc.getXmlFragment(FRAGMENT)
  return { type: 'doc', content: frag.toArray().flatMap(yNodeToJSON) }
}

function yNodeToJSON(node: unknown): PMNode[] {
  if (node instanceof Y.XmlText) {
    const delta = node.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]
    return delta
      .filter((d) => typeof d.insert === 'string' && d.insert.length > 0)
      .map((d) => {
        const n: PMNode = { type: 'text', text: d.insert as string }
        if (d.attributes) {
          const marks: PMMark[] = Object.entries(d.attributes).map(([k, v]) => {
            const m: PMMark = { type: k.split('--')[0] }
            if (v && typeof v === 'object' && Object.keys(v).length) m.attrs = v as Record<string, unknown>
            return m
          })
          if (marks.length) n.marks = marks
        }
        return n
      })
  }
  if (node instanceof Y.XmlElement) {
    const n: PMNode = { type: node.nodeName }
    const attrs = node.getAttributes() as Record<string, unknown>
    if (Object.keys(attrs).length) n.attrs = attrs
    const content = node.toArray().flatMap(yNodeToJSON)
    if (content.length) n.content = content
    return [n]
  }
  return []
}

export function replaceDocContent(doc: Y.Doc, json: PMNode, origin: unknown): void {
  doc.transact(() => {
    const frag = doc.getXmlFragment(FRAGMENT)
    frag.delete(0, frag.length)
    frag.insert(0, jsonChildrenToY(json.content ?? []))
  }, origin)
}

function jsonChildrenToY(nodes: PMNode[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = []
  let textRun: PMNode[] = []
  const flush = () => {
    if (!textRun.length) return
    const t = new Y.XmlText()
    t.applyDelta(
      textRun.map((n) => ({
        insert: n.text ?? '',
        attributes: n.marks?.length
          ? Object.fromEntries(n.marks.map((m) => [m.type, m.attrs ?? {}]))
          : undefined,
      })),
    )
    out.push(t)
    textRun = []
  }
  for (const n of nodes) {
    if (n.type === 'text') {
      textRun.push(n)
      continue
    }
    flush()
    const el = new Y.XmlElement(n.type)
    for (const [k, v] of Object.entries(n.attrs ?? {})) {
      if (v !== null && v !== undefined) el.setAttribute(k, v as string)
    }
    el.insert(0, jsonChildrenToY(n.content ?? []))
    out.push(el)
  }
  flush()
  return out
}

/* ---------------- 纯文本（用于搜索、摘要） ---------------- */

const BLOCKS = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'horizontalRule',
])

export function jsonToText(node: PMNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'guideCard') return [cardAttr(node, 'title'), cardAttr(node, 'desc')].filter(Boolean).join(' ') + '\n'
  if (node.type === 'hardBreak') return '\n'
  const inner = (node.content ?? []).map(jsonToText).join('')
  return BLOCKS.has(node.type) ? inner + '\n' : inner
}

/* ---------------- HTML（服务端只读渲染） ---------------- */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function safeUrl(url: unknown, kind: 'link' | 'image'): string | null {
  if (typeof url !== 'string') return null
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/') && !u.startsWith('//')) return u
  if (u.startsWith('#')) return u
  if (kind === 'link' && /^mailto:/i.test(u)) return u
  return null
}

/** 引导卡片的属性（编辑器里都是字符串，这里防御一下） */
function cardAttr(n: PMNode, k: 'icon' | 'title' | 'desc' | 'href'): string {
  const v = n.attrs?.[k]
  return typeof v === 'string' ? v.trim() : ''
}

/** 与编辑器中 web/src/editor/GuideCards.tsx 的结构一致 */
function guideCardHtml(n: PMNode): string {
  const icon = cardAttr(n, 'icon')
  const desc = cardAttr(n, 'desc')
  const body =
    (icon ? `<span class="guide-icon">${escapeHtml(icon)}</span>` : '') +
    `<span class="guide-body"><strong>${escapeHtml(cardAttr(n, 'title') || '未命名卡片')}</strong>${desc ? `<span>${escapeHtml(desc)}</span>` : ''}</span>`
  const href = safeUrl(cardAttr(n, 'href'), 'link')
  if (!href) return `<div class="guide-card">${body}</div>`
  const external = /^https?:/i.test(href) ? ' rel="noopener nofollow ugc" target="_blank"' : ''
  return `<a class="guide-card" href="${escapeHtml(href)}"${external}>${body}</a>`
}

function renderMarks(text: string, marks: PMMark[] = []): string {
  let html = escapeHtml(text)
  for (const m of marks) {
    switch (m.type) {
      case 'bold': html = `<strong>${html}</strong>`; break
      case 'italic': html = `<em>${html}</em>`; break
      case 'strike': html = `<s>${html}</s>`; break
      case 'underline': html = `<u>${html}</u>`; break
      case 'code': html = `<code>${html}</code>`; break
      case 'link': {
        const href = safeUrl(m.attrs?.href, 'link')
        if (href) html = `<a href="${escapeHtml(href)}" rel="noopener nofollow ugc" target="_blank">${html}</a>`
        break
      }
    }
  }
  return html
}

export function jsonToHtml(node: PMNode): string {
  const inner = () => (node.content ?? []).map(jsonToHtml).join('')
  const a = node.attrs ?? {}
  switch (node.type) {
    case 'doc': return inner()
    case 'text': return renderMarks(node.text ?? '', node.marks)
    case 'paragraph': return `<p>${inner()}</p>`
    case 'heading': {
      const lv = Math.min(6, Math.max(1, Number(a.level) || 1))
      return `<h${lv}>${inner()}</h${lv}>`
    }
    case 'blockquote': return `<blockquote>${inner()}</blockquote>`
    case 'bulletList': return `<ul>${inner()}</ul>`
    case 'orderedList': {
      const start = Number(a.start) || 1
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>${inner()}</ol>`
    }
    case 'listItem': return `<li>${inner()}</li>`
    case 'taskList': return `<ul class="task-list">${inner()}</ul>`
    case 'taskItem':
      return `<li class="task-item"><input type="checkbox" disabled${a.checked ? ' checked' : ''}><div>${inner()}</div></li>`
    case 'codeBlock': {
      const lang = typeof a.language === 'string' ? a.language.replace(/[^\w-]/g, '') : ''
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(code)}</code></pre>`
    }
    case 'horizontalRule': return '<hr>'
    case 'guideCards': return `<div class="guide-cards">${inner()}</div>`
    case 'guideCard': return guideCardHtml(node)
    case 'hardBreak': return '<br>'
    case 'image': {
      const src = safeUrl(a.src, 'image')
      if (!src) return ''
      const alt = typeof a.alt === 'string' ? a.alt : ''
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`
    }
    default: return inner()
  }
}

/* ---------------- Markdown 导出 ---------------- */

function mdInline(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`
      let t = n.text ?? ''
      const marks = n.marks ?? []
      const has = (k: string) => marks.some((m) => m.type === k)
      if (has('code')) t = '`' + t + '`'
      if (has('bold')) t = `**${t}**`
      if (has('italic')) t = `*${t}*`
      if (has('strike')) t = `~~${t}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link) t = `[${t}](${link.attrs?.href ?? ''})`
      return t
    })
    .join('')
}

function mdBlocks(nodes: PMNode[] = [], indent = ''): string {
  return nodes.map((n) => mdBlock(n, indent)).join('\n\n')
}

function mdBlock(n: PMNode, indent: string): string {
  const a = n.attrs ?? {}
  switch (n.type) {
    case 'paragraph': return indent + mdInline(n.content)
    case 'heading': return indent + '#'.repeat(Number(a.level) || 1) + ' ' + mdInline(n.content)
    case 'blockquote':
      return mdBlocks(n.content, indent).split('\n').map((l) => `${indent}> ${l.slice(indent.length)}`).join('\n')
    case 'codeBlock':
      return `${indent}\`\`\`${a.language ?? ''}\n${(n.content ?? []).map((c) => c.text).join('')}\n${indent}\`\`\``
    case 'horizontalRule': return indent + '---'
    case 'image': return indent + mdInline([n])
    case 'guideCards':
      return (n.content ?? [])
        .map((c) => {
          const title = cardAttr(c, 'title') || '未命名卡片'
          const href = safeUrl(cardAttr(c, 'href'), 'link')
          const desc = cardAttr(c, 'desc')
          return `${indent}- ${[cardAttr(c, 'icon'), href ? `[${title}](${href})` : title].filter(Boolean).join(' ')}${desc ? `：${desc}` : ''}`
        })
        .join('\n')
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      let i = Number(a.start) || 1
      return (n.content ?? [])
        .map((item) => {
          const marker =
            n.type === 'orderedList' ? `${i++}. ` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- '
          const body = mdBlocks(item.content, indent + '  ').slice(indent.length + 2)
          return indent + marker + body
        })
        .join('\n')
    }
    default: return mdBlocks(n.content, indent)
  }
}

export function jsonToMarkdown(title: string, doc: PMNode): string {
  return `# ${title}\n\n${mdBlocks(doc.content)}\n`
}

export const EMPTY_DOC: PMNode = { type: 'doc', content: [{ type: 'paragraph' }] }
