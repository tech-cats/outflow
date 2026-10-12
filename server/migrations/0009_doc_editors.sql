-- 文档协作者：被授权的用户可以编辑该文档及其全部子文档的内容和标题
CREATE TABLE doc_editors (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, user_id)
);
CREATE INDEX doc_editors_user ON doc_editors(user_id);
