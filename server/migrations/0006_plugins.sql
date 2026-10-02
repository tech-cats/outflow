-- 插件的通用数据存储：插件不自带迁移，按「插件 / 类型 / 键」存 JSON
CREATE TABLE plugin_data (
  plugin TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (plugin, kind, key)
);

-- 不属于任何文档的公开图片（如插件里的地点照片），只有编辑及以上可以上传
ALTER TABLE uploads ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
