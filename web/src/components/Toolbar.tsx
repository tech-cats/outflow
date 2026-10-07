import { useEditorState, type Editor } from '@tiptap/react'
import { useRef } from 'react'
import { newGuideCards } from '../editor/GuideCards'

interface Props {
  editor: Editor
  onUpload(file: File): Promise<string | null>
}

export function Toolbar({ editor, onUpload }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
    }),
  })

  const chain = () => editor.chain().focus()
  const B = (p: { on?: boolean; title: string; onClick(): void; children: React.ReactNode }) => (
    <button
      type="button"
      className={`tb-btn${p.on ? ' on' : ''}`}
      title={p.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  )

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = prompt('链接地址（留空则移除链接）', prev ?? 'https://')
    if (url === null) return
    if (!url.trim()) chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  return (
    <div className="toolbar">
      <B title="撤销 (⌘Z)" onClick={() => chain().undo().run()}>↶</B>
      <B title="重做 (⌘⇧Z)" onClick={() => chain().redo().run()}>↷</B>
      <span className="tb-sep" />
      <B on={s.h1} title="一级标题" onClick={() => chain().toggleHeading({ level: 1 }).run()}>H1</B>
      <B on={s.h2} title="二级标题" onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</B>
      <B on={s.h3} title="三级标题" onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</B>
      <span className="tb-sep" />
      <B on={s.bold} title="加粗 (⌘B)" onClick={() => chain().toggleBold().run()}><b>B</b></B>
      <B on={s.italic} title="斜体 (⌘I)" onClick={() => chain().toggleItalic().run()}><i>I</i></B>
      <B on={s.strike} title="删除线" onClick={() => chain().toggleStrike().run()}><s>S</s></B>
      <B on={s.code} title="行内代码" onClick={() => chain().toggleCode().run()}>{'</>'}</B>
      <B on={s.link} title="链接" onClick={setLink}>🔗</B>
      <span className="tb-sep" />
      <B on={s.bullet} title="无序列表" onClick={() => chain().toggleBulletList().run()}>•≡</B>
      <B on={s.ordered} title="有序列表" onClick={() => chain().toggleOrderedList().run()}>1≡</B>
      <B on={s.task} title="任务列表" onClick={() => chain().toggleTaskList().run()}>☑</B>
      <B on={s.quote} title="引用" onClick={() => chain().toggleBlockquote().run()}>❝</B>
      <B on={s.codeBlock} title="代码块" onClick={() => chain().toggleCodeBlock().run()}>{'{ }'}</B>
      <B title="分割线" onClick={() => chain().setHorizontalRule().run()}>―</B>
      <B title="引导卡片：带图标、标题、说明和链接的卡片，适合放在首页" onClick={() => chain().insertContent(newGuideCards).run()}>▦</B>
      <B title="插入图片（也可直接粘贴/拖入）" onClick={() => fileRef.current?.click()}>🖼</B>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const url = await onUpload(f)
          if (url) chain().setImage({ src: url, alt: f.name }).run()
        }}
      />
    </div>
  )
}
