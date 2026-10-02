-- 站内通知；评论或文档删除时随之删除
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id TEXT,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  excerpt TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);
CREATE INDEX notifications_unread ON notifications(user_id, read_at);

-- 是否接收邮件通知（站内通知始终开启）
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
