-- 0004_project_reset.sql — P6-1：项目重置审计回执（catalog 侧）。
-- 归档/删除项目记忆都必须留可复核 receipt；确认令牌只存哈希。

-- 第一部分：
CREATE TABLE project_reset_receipts(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('archive','delete')),
  confirm_token_hash TEXT NOT NULL,
  claims_before INTEGER NOT NULL,
  claims_after INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- 第二部分：

