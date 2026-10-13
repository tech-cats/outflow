-- 文档的自定义链接：/d/<slug>。旧链接（改过的 slug）记在 doc_slugs 中，访问时跳转到当前地址
ALTER TABLE docs ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX docs_slug ON docs(slug) WHERE slug IS NOT NULL;
CREATE TABLE doc_slugs (
  slug TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE
);
CREATE INDEX doc_slugs_doc ON doc_slugs(doc_id);
