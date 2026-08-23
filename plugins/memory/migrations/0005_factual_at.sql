-- 0005_factual_at.sql — 事实时间列（Cyrus 拍板 2026-08-17）：项目记忆需区分新旧，记录事实发生时间（Codex 导入取源消息时间戳；会话内提取取事件时间）；全局经验类不强求。
-- 只有分片 claims 需要该列；catalog 侧留空（0004 同款分半模式）。
-- 第一部分：
-- 第二部分：
ALTER TABLE claims ADD COLUMN factual_at TEXT;
