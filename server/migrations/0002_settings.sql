-- 管理后台可调整的运行时设置（如地域白名单），覆盖环境变量默认值
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
