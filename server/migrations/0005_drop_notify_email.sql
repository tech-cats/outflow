-- 已移除邮件通知（只保留站内通知），删除对应的用户设置
ALTER TABLE users DROP COLUMN notify_email;
