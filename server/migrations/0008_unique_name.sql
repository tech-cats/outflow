-- 昵称唯一（不区分英文大小写）。先给已有的重名用户加上 id 后缀，保留最早注册的那位不变
UPDATE users SET name = substr(name, 1, 35) || '_' || substr(id, 1, 4)
WHERE EXISTS (
  SELECT 1 FROM users u2
  WHERE lower(u2.name) = lower(users.name)
    AND (u2.created_at < users.created_at OR (u2.created_at = users.created_at AND u2.id < users.id))
);
CREATE UNIQUE INDEX users_name ON users(lower(name));
