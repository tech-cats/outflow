-- 评论：anchor 为空是文末讨论；非空是行内批注，内容为 Yjs 相对位置（JSON: {"from","to"}，base64）
-- 回复只有一层，parent_id 指向根评论；解决状态只记录在根评论上
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  anchor TEXT,
  quote TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_doc ON comments(doc_id, created_at);
CREATE INDEX comments_parent ON comments(parent_id);
