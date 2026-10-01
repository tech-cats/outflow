import type { DB, User, Visibility } from '../types'

/**
 * 可见性规则：
 *  public    —— 所有人可读
 *  protected —— 登录用户可读
 *  draft     —— 仅作者与管理员可读
 * 文档的有效可见性由自身与所有祖先共同决定（任何一级不可读即不可读），
 * 因此子文档永远不会比父文档更开放。
 */

export interface DocNode {
  id: string
  parent_id: string | null
  visibility: Visibility
  author_id: string
  locked?: number
}

export const VISIBILITIES: Visibility[] = ['public', 'protected', 'draft']
const RANK: Record<Visibility, number> = { public: 0, protected: 1, draft: 2 }

export function nodeReadable(user: User | null, n: DocNode): boolean {
  if (n.visibility === 'public') return true
  if (!user) return false
  if (n.visibility === 'protected') return true
  return user.role === 'admin' || user.id === n.author_id
}

/** 取文档及其全部祖先（[自身, 父, 祖父, ...]） */
export async function loadChain(db: DB, docId: string): Promise<DocNode[]> {
  return db.all<DocNode & { depth: number }>(
    `WITH RECURSIVE chain(id, parent_id, visibility, author_id, locked, depth) AS (
       SELECT id, parent_id, visibility, author_id, locked, 0 FROM docs WHERE id = ?
       UNION ALL
       SELECT d.id, d.parent_id, d.visibility, d.author_id, d.locked, c.depth + 1
       FROM docs d JOIN chain c ON d.id = c.parent_id
       WHERE c.depth < 64
     ) SELECT * FROM chain ORDER BY depth`,
    docId,
  )
}

export function chainReadable(user: User | null, chain: DocNode[]): boolean {
  return chain.length > 0 && chain.every((n) => nodeReadable(user, n))
}

export function effectiveVisibility(chain: DocNode[]): Visibility {
  return chain.reduce<Visibility>((acc, n) => (RANK[n.visibility] > RANK[acc] ? n.visibility : acc), 'public')
}

export function canEditChain(user: User | null, chain: DocNode[]): boolean {
  if (!user || !chainReadable(user, chain)) return false
  return !chain[0].locked || user.role === 'admin'
}

/** 对一个集合内的扁平文档列表做可读性过滤（父不可读则子也不可读） */
export function filterReadable<T extends DocNode>(user: User | null, docs: T[]): T[] {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const memo = new Map<string, boolean>()
  const ok = (d: T, depth = 0): boolean => {
    const cached = memo.get(d.id)
    if (cached !== undefined) return cached
    let r = nodeReadable(user, d)
    if (r && d.parent_id) {
      const parent = byId.get(d.parent_id)
      r = !!parent && depth < 64 && ok(parent, depth + 1)
    }
    memo.set(d.id, r)
    return r
  }
  return docs.filter((d) => ok(d))
}
