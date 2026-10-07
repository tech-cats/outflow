import { useMemo, useState } from 'react'
import { api, type DocMeta, type Topic } from '../api'

type DropPos = 'before' | 'inside' | 'after'

interface Props {
  topics: Topic[]
  docs: DocMeta[]
  activeId?: string
  /** 能否在该文档下新建子文档 */
  canAdd(d: DocMeta): boolean
  /** 能否拖动该文档 */
  canMove(d: DocMeta): boolean
  /** 能否在主题下新建顶级文档 */
  canAddTop: boolean
  onOpen(id: string): void
  onAdd(at: { topicId?: string; parentId?: string }): void
  onChanged(): void
}

/**
 * 侧边栏文档树，按主题分组：拖到行的上/下 1/4 处为同级排序，拖到中间为设为子文档，
 * 拖到主题名上为移到该主题的末尾。
 */
export function DocTree({ topics, docs, activeId, canAdd, canMove, canAddTop, onOpen, onAdd, onChanged }: Props) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: DropPos } | null>(null)
  const [overTopic, setOverTopic] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // 顶级文档以 "t:主题 id" 为键，子文档以父文档 id 为键（父文档不可读时当作顶级）
  const children = useMemo(() => {
    const m = new Map<string, DocMeta[]>()
    const ids = new Set(docs.map((d) => d.id))
    for (const d of docs) {
      const k = d.parentId && ids.has(d.parentId) ? d.parentId : `t:${d.topicId}`
      m.set(k, [...(m.get(k) ?? []), d])
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort)
    return m
  }, [docs])
  const keyOf = (d: DocMeta) => (d.parentId && docs.some((x) => x.id === d.parentId) ? d.parentId : `t:${d.topicId}`)

  const isDescendant = (id: string, ancestor: string): boolean => {
    let cur = docs.find((d) => d.id === id)
    for (let i = 0; cur && i < 64; i++) {
      if (cur.parentId === ancestor) return true
      cur = docs.find((d) => d.id === cur!.parentId)
    }
    return false
  }

  const move = async (src: string, body: Record<string, unknown>) => {
    try {
      await api(`/docs/${src}`, { method: 'PATCH', body })
    } catch (e) {
      alert((e as Error).message)
    }
    onChanged()
  }

  const reset = () => {
    setDrag(null)
    setOver(null)
    setOverTopic(null)
  }

  const drop = async (targetId: string, pos: DropPos) => {
    const src = drag
    reset()
    if (!src || src === targetId || isDescendant(targetId, src)) return
    const target = docs.find((d) => d.id === targetId)!
    if (pos === 'inside') {
      const kids = children.get(targetId) ?? []
      return move(src, { parentId: targetId, sort: (kids.at(-1)?.sort ?? 0) + 1 })
    }
    const sibs = (children.get(keyOf(target)) ?? []).filter((d) => d.id !== src)
    const i = sibs.findIndex((d) => d.id === targetId)
    const prev = pos === 'before' ? sibs[i - 1] : sibs[i]
    const next = pos === 'before' ? sibs[i] : sibs[i + 1]
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1 : next ? next.sort - 1 : 0
    return move(src, { parentId: target.parentId, topicId: target.topicId, sort })
  }

  const dropOnTopic = async (topicId: string) => {
    const src = drag
    reset()
    if (src) await move(src, { parentId: null, topicId })
  }

  const render = (key: string, depth: number): React.ReactNode => {
    const list = children.get(key)
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
                draggable={canMove(d)}
                onDragStart={(e) => {
                  setDrag(d.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={reset}
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
                {canAdd(d) && (
                  <button
                    className="tree-add"
                    title="添加子文档"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAdd({ parentId: d.id })
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

  return (
    <div className="tree">
      {topics.map((t) => (
        <section key={t.id} className="tree-topic">
          <h3
            className={overTopic === t.id ? 'drop-inside' : undefined}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              setOverTopic(t.id)
            }}
            onDragLeave={() => setOverTopic((x) => (x === t.id ? null : x))}
            onDrop={(e) => {
              e.preventDefault()
              void dropOnTopic(t.id)
            }}
          >
            <a href={`/c/${t.id}`}>{t.name}</a>
            {canAddTop && (
              <button className="tree-add visible" title="在此主题下新建文档" onClick={() => onAdd({ topicId: t.id })}>
                +
              </button>
            )}
          </h3>
          {children.has(`t:${t.id}`) ? render(`t:${t.id}`, 0) : <p className="muted small tree-empty">暂无文档</p>}
        </section>
      ))}
    </div>
  )
}
