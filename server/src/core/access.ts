import { HOME_DOC_ID } from './site'
import type { DB, Role, User, Visibility } from '../types'

/**
 * 角色（全局，逐级包含）：
 *  member      —— 阅读登录可见的文档、评论
 *  contributor —— 新建文档，编辑、发布、移动、删除自己的文档
 *  editor      —— 审稿：编辑、移动、删除他人的文档，新建和整理主题
 *  admin       —— 锁定文档、删除主题、管理用户、站点设置；可看所有草稿
 *
 * 文档协作者（doc_editors）：作者或编辑可以把某篇文档的编辑权授予任意用户，授权沿文档树向下继承。
 * 协作者只能修改内容和标题，不能删除、移动或修改可见性；锁定的文档协作者同样不能编辑。
 */
export const ROLES: Role[] = ['member', 'contributor', 'editor', 'admin']

export function hasRole(user: User | null, role: Role): boolean {
  return !!user && ROLES.indexOf(user.role) >= ROLES.indexOf(role)
}

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
  /** 当前用户是否被直接授予了这篇文档的编辑权（仅 loadChain 传入 userId 时有值） */
  granted?: number
}

export const VISIBILITIES: Visibility[] = ['public', 'protected', 'draft']
const RANK: Record<Visibility, number> = { public: 0, protected: 1, draft: 2 }

export function nodeReadable(user: User | null, n: DocNode): boolean {
  if (n.visibility === 'public') return true
  if (!user) return false
  if (n.visibility === 'protected') return true
  return user.role === 'admin' || user.id === n.author_id
}

/**
 * 取文档及其全部祖先（[自身, 父, 祖父, ...]）。
 * 需要判断编辑权时传入 userId，以便带上协作者授权；不传则只按角色判断。
 */
export async function loadChain(db: DB, docId: string, userId: string | null = null): Promise<DocNode[]> {
  return db.all<DocNode & { depth: number }>(
    `WITH RECURSIVE chain(id, parent_id, visibility, author_id, locked, depth) AS (
       SELECT id, parent_id, visibility, author_id, locked, 0 FROM docs WHERE id = ?
       UNION ALL
       SELECT d.id, d.parent_id, d.visibility, d.author_id, d.locked, c.depth + 1
       FROM docs d JOIN chain c ON d.id = c.parent_id
       WHERE c.depth < 64
     ) SELECT c.*, EXISTS(SELECT 1 FROM doc_editors e WHERE e.doc_id = c.id AND e.user_id = ?) AS granted
       FROM chain c ORDER BY depth`,
    docId,
    userId,
  )
}

export function chainReadable(user: User | null, chain: DocNode[]): boolean {
  return chain.length > 0 && chain.every((n) => nodeReadable(user, n))
}

export function effectiveVisibility(chain: DocNode[]): Visibility {
  return chain.reduce<Visibility>((acc, n) => (RANK[n.visibility] > RANK[acc] ? n.visibility : acc), 'public')
}

/**
 * 能否管理文档（可见性、位置、删除、授予协作者）：
 * 锁定的文档只有管理员能改；否则编辑及以上可管理任意文档，贡献者只能管理自己的。
 */
export function canManageChain(user: User | null, chain: DocNode[]): boolean {
  if (!user || !hasRole(user, 'contributor') || !chainReadable(user, chain)) return false
  const doc = chain[0]
  if (user.role === 'admin') return true
  if (doc.locked) return false
  return hasRole(user, 'editor') || doc.author_id === user.id
}

/**
 * 能否修改文档内容和标题：能管理的人，加上本文或任一祖先的协作者（不限角色）。
 * 协作者授权需要 loadChain 传入当前用户 id 才会生效。
 */
export function canEditChain(user: User | null, chain: DocNode[]): boolean {
  if (canManageChain(user, chain)) return true
  if (!user || !chainReadable(user, chain) || chain[0].locked) return false
  return chain.some((n) => !!n.granted)
}

/** 能否在该文档下新建子文档（子文档归新建者所有） */
export function canAddChild(user: User | null, chain: DocNode[]): boolean {
  // 首页文档不显示在文档树中，因此不允许有子文档
  if (!user || chain[0].id === HOME_DOC_ID || !hasRole(user, 'contributor') || !chainReadable(user, chain)) return false
  return !chain[0].locked || user.role === 'admin'
}

/** 设为草稿 / 发布草稿：草稿只对作者和管理员可见，因此只允许他们切换 */
export function canToggleDraft(user: User | null, doc: DocNode): boolean {
  return !!user && (user.role === 'admin' || user.id === doc.author_id)
}

/** 对扁平文档列表做可读性过滤（父不可读则子也不可读） */
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
