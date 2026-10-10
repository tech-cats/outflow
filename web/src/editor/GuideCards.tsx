import { Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, type ReactNodeViewProps } from '@tiptap/react'

/**
 * 引导卡片：一组带图标、标题、说明和链接的卡片，适合放在首页把访客引到常用文档。
 * 服务端渲染见 server/src/lib/prosemirror.ts，两边的 HTML 结构和类名保持一致。
 */

const ATTRS = ['icon', 'title', 'desc', 'href'] as const

export const GuideCards = Node.create({
  name: 'guideCards',
  group: 'block',
  content: 'guideCard+',
  parseHTML: () => [{ tag: 'div[data-guide-cards]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'guide-cards', 'data-guide-cards': '' }), 0],
})

export const GuideCard = Node.create({
  name: 'guideCard',
  atom: true,
  selectable: true,
  addAttributes: () =>
    Object.fromEntries(
      ATTRS.map((k) => [
        k,
        {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? '',
          renderHTML: (a: Record<string, string>) => ({ [`data-${k}`]: a[k] }),
        },
      ]),
    ),
  parseHTML: () => [{ tag: 'div[data-guide-card]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-guide-card': '' })],
  addNodeView: () => ReactNodeViewRenderer(CardView),
})

/** 插入一组新卡片（两张空白卡片） */
export const newGuideCards = { type: 'guideCards', content: [{ type: 'guideCard' }, { type: 'guideCard' }] }

function CardView({ node, editor, getPos, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const a = node.attrs as Record<(typeof ATTRS)[number], string>
  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="guide-card">
        {a.icon && <span className="guide-icon">{a.icon}</span>}
        <span className="guide-body">
          <strong>{a.title || '未命名卡片'}</strong>
          {a.desc && <span>{a.desc}</span>}
        </span>
      </NodeViewWrapper>
    )
  }
  const pos = () => getPos() ?? 0
  const insertAfter = () =>
    editor
      .chain()
      .insertContentAt(pos() + node.nodeSize, { type: 'guideCard' })
      .run()
  // 删除最后一张卡片时连同整组一起删除（卡片组至少要有一张卡片）
  const remove = () => {
    const $pos = editor.state.doc.resolve(pos())
    if ($pos.parent.childCount > 1) deleteNode()
    else editor.chain().deleteRange({ from: $pos.before(), to: $pos.after() }).run()
  }
  const field = (k: (typeof ATTRS)[number], placeholder: string, maxLength: number) => (
    <input
      className={`guide-input guide-input-${k}`}
      value={a[k]}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => updateAttributes({ [k]: e.target.value })}
    />
  )
  return (
    <NodeViewWrapper className="guide-card editing" contentEditable={false}>
      {field('icon', '🧭', 4)}
      <span className="guide-body">
        {field('title', '标题', 40)}
        <textarea
          className="guide-input guide-input-desc"
          rows={1}
          value={a.desc}
          placeholder="一句话说明（可选）"
          maxLength={120}
          // 随内容自动增高，和阅读页一样完整显示
          ref={(el) => {
            if (!el) return
            el.style.height = 'auto'
            el.style.height = el.scrollHeight + 'px'
          }}
          onChange={(e) => updateAttributes({ desc: e.target.value.replace(/\n/g, ' ') })}
        />
        {field('href', '链接：/d/文档 ID 或 https://…', 300)}
      </span>
      <span className="guide-tools">
        <button type="button" title="在后面加一张卡片" onClick={insertAfter}>
          +
        </button>
        <button type="button" title="删除这张卡片" onClick={remove}>
          ×
        </button>
      </span>
    </NodeViewWrapper>
  )
}
