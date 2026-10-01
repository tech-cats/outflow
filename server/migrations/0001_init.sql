CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_codes_email ON email_codes(email, purpose, created_at);

CREATE TABLE email_rules (
  pattern TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE captcha_used (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_visibility TEXT NOT NULL DEFAULT 'public',
  sort REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public',
  locked INTEGER NOT NULL DEFAULT 0,
  author_id TEXT NOT NULL,
  ystate TEXT,
  content TEXT,
  text TEXT NOT NULL DEFAULT '',
  sort REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX docs_collection ON docs(collection_id, parent_id, sort);
CREATE INDEX docs_parent ON docs(parent_id);
CREATE INDEX docs_updated ON docs(updated_at);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX revisions_doc ON revisions(doc_id, created_at);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  doc_id TEXT REFERENCES docs(id) ON DELETE SET NULL,
  key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
