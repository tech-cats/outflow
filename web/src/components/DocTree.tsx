import { useMemo, useState } from 'react'
import { api, type DocMeta } from '../api'

type DropPos = 'before' | 'inside' | 'after'

interface Props {
  docs: DocMeta[]
  activeId?: string
  canWrite: boolean
  onOpen(id: string): void
  onAddChild(parentId: string | null): void
  onChanged(): void
}

/** 侧边栏文档树：拖到行的上/下 1/4 处为同级排序，拖到中间为设为子文档 */
export function DocTree({ docs, activeId, canWrite, onOpen, onAddChild, onChanged }: Props) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: DropPos } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const children = useMemo(() => {
    const m = new Map<string | null, DocMeta[]>()
    const ids = new Set(docs.map((d) => d.id))
    for (const d of docs) {
      const k = d.parentId && ids.has(d.parentId) ? d.parentId : null
      m.set(k, [...(m.get(k) ?? []), d])
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort)
    return m
  }, [docs])

  const isDescendant = (id: string, ancestor: string): boolean => {
    let cur = docs.find((d) => d.id === id)
    for (let i = 0; cur && i < 64; i++) {
      if (cur.parentId === ancestor) return true
      cur = docs.find((d) => d.id === cur!.parentId)
    }
    return false
  }

  const drop = async (targetId: string, pos: DropPos) => {
    const src = drag
    setDrag(null)
    setOver(null)
    if (!src || src === targetId || isDescendant(targetId, src)) return
    const target = docs.find((d) => d.id === targetId)!
    let parentId: string | null
    let sort: number
    if (pos === 'inside') {
      parentId = targetId
      const kids = children.get(targetId) ?? []
      sort = (kids.at(-1)?.sort ?? 0) + 1
    } else {
      parentId = target.parentId
      const sibs = (children.get(parentId) ?? []).filter((d) => d.id !== src)
      const i = sibs.findIndex((d) => d.id === targetId)
      const prev = pos === 'before' ? sibs[i - 1] : sibs[i]
      const next = pos === 'before' ? sibs[i] : sibs[i + 1]
      sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1 : next ? next.sort - 1 : 0
    }
    try {
      await api(`/docs/${src}`, { method: 'PATCH', body: { parentId, sort } })
    } catch (e) {
      alert((e as Error).message)
    }
    onChanged()
  }

  const render = (parent: string | null, depth: number): React.ReactNode => {
    const list = children.get(parent)
    if (!list || depth > 20) return null
    return (
      <ul>
        {list.map((d) => {
          const hasKids = children.has(d.id)
          const isCollapsed = collapsed.has(d.id)
          const o = over?.id === d.id ? over.pos : null
          return (
            <li key={d.id}>
              <div
                className={`row tree-row${d.id === activeId ? ' active' : ''}${o ? ` drop-${o}` : ''}`}
                draggable={canWrite}
                onDragStart={(e) => {
                  setDrag(d.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  setDrag(null)
                  setOver(null)
                }}
                onDragOver={(e) => {
                  if (!drag || drag === d.id) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = (e.clientY - r.top) / r.height
                  setOver({ id: d.id, pos: y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside' })
                }}
                onDragLeave={() => setOver((x) => (x?.id === d.id ? null : x))}
                onDrop={(e) => {
                  e.preventDefault()
                  if (over) void drop(d.id, over.pos)
                }}
                onClick={() => onOpen(d.id)}
              >
                <span
                  className={`twisty${hasKids ? '' : ' hidden'}${isCollapsed ? '' : ' open'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollapsed((s) => {
                      const n = new Set(s)
                      if (n.has(d.id)) n.delete(d.id)
                      else n.add(d.id)
                      return n
                    })
                  }}
                >
                  ▸
                </span>
                <span className="tree-title">{d.title || '无标题'}</span>
                {d.visibility !== 'public' && <span className={`dot ${d.visibility}`} title={d.visibility} />}
                {canWrite && (
                  <button
                    className="tree-add"
                    title="添加子文档"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddChild(d.id)
                    }}
                  >
                    +
                  </button>
                )}
              </div>
              {!isCollapsed && render(d.id, depth + 1)}
            </li>
          )
        })}
      </ul>
    )
  }

  return <div className="tree">{docs.length ? render(null, 0) : <p className="muted small" style={{ padding: '0 10px' }}>暂无文档</p>}</div>
}
