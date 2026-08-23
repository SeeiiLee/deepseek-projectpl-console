-- 0002：候选 TTL（P3）——claims 增加 expires_at；catalog 无需变更。
-- 第一部分：

-- 第二部分：
ALTER TABLE claims ADD COLUMN expires_at TEXT;
