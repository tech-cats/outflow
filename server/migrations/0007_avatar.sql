-- 用户头像（/uploads/<id>，公开图片）；为空时显示用户名首字
ALTER TABLE users ADD COLUMN avatar TEXT;
