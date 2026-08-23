-- MEMORY_SCHEMA_V1.sql — Personal 记忆系统 Schema v1（catalog + 分片库）
-- 状态：P0 交付物 #3（2026-08-15）。与 docs/记忆系统手册.md v3 §9.3.1/§9.4.3 一致；本文件是执行副本，手册内联 SQL 以本文件为准。
-- 引擎要求：SQLite >= 3.37（STRICT）；建议随 Node >= 24 的 node:sqlite（含 FTS5）运行。
-- 连接要求：每连接执行 PRAGMA foreign_keys = ON；分片库使用 WAL。
-- 迁移纪律：append-only 迁移文件 + from/to + checksum；meta.schemaVersion 记录当前版本。

-- =====================================================================
-- 第一部分：catalog.sqlite3（记忆侧目录；不复制 Project Control canonical 元数据）
-- =====================================================================
PRAGMA journal_mode = WAL;

CREATE TABLE memory_projects(
  project_id TEXT PRIMARY KEY,       -- 引用 Project Control projects.project_id（唯一身份源，见 MEMORY_PROJECT_IDENTITY_CONTRACT.md）
  memory_policy_id TEXT,
  sensitivity_class TEXT NOT NULL DEFAULT 'internal'
    CHECK (sensitivity_class IN ('public','internal','sensitive','restricted')),
  retention_policy TEXT,
  shard_locator TEXT NOT NULL,       -- 相对 locator：projects/<project_id>/memory.sqlite3（不写绝对路径主键）
  source_revision INTEGER,           -- 最近同步的 Project Control revision（cache 用途）
  is_cache INTEGER NOT NULL DEFAULT 0 CHECK (is_cache IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO meta(key, value) VALUES ('schemaVersion', '1');

-- =====================================================================
-- 第二部分：分片库 schema（global/patterns、private/user、projects/<project_id>/memory.sqlite3 共用）
-- =====================================================================
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 全部表 STRICT；枚举用 CHECK；删除语义见文件末尾对照表。
CREATE TABLE claims(
  id TEXT PRIMARY KEY,                        -- uuidv7
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global_user','portfolio','project','workspace')),
  scope_id TEXT NOT NULL,                     -- 非空（修 NULL 唯一键失效）：user:<id> / portfolio_id / project_id / workspace_id
  kind TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  searchable_text TEXT NOT NULL DEFAULT '',   -- 派生检索文本（ASCII 词 + 中文二元组，写入时计算；可整体重建）
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','active','disputed','superseded','archived')),
  authority_class TEXT NOT NULL DEFAULT 'llm_extracted'
    CHECK (authority_class IN ('user_confirmed','repo_verified','machine_observed','llm_extracted')),
  confidence INTEGER NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  importance INTEGER NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  sensitivity_class TEXT NOT NULL DEFAULT 'internal'
    CHECK (sensitivity_class IN ('public','internal','sensitive','restricted')),
  retention_policy TEXT,
  valid_from TEXT, valid_until TEXT,
  applicable_version TEXT,
  last_verified_at TEXT,                      -- freshness 是派生值（now − last_verified_at），不重复落库
  superseded_by TEXT REFERENCES claims(id) ON DELETE SET NULL,
  normalized_content_hash TEXT NOT NULL,
  extractor_id TEXT, extractor_version TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(scope_kind, scope_id, kind, normalized_content_hash)
) STRICT;
CREATE INDEX idx_claims_scope ON claims(scope_kind, scope_id, kind, status);
CREATE INDEX idx_claims_status ON claims(status, updated_at);

CREATE TABLE evidence_sources(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('repo_file','rollout','session','command','artifact','user_confirmation')),
  portable_locator TEXT NOT NULL,   -- project://<project_id>/docs/NEXT.md#x 或 session://<id>#<turn>
  local_locator TEXT,               -- 本机绝对路径（可变，仅作解析 alias；导出时默认省略/重绑定）
  source_hash TEXT,
  captured_at TEXT NOT NULL,
  last_verified_at TEXT,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','moved','deleted','unknown')),
  sensitivity_class TEXT NOT NULL DEFAULT 'internal' CHECK (sensitivity_class IN ('public','internal','sensitive','restricted')),
  secure_excerpt_ref TEXT
) STRICT;

CREATE TABLE claim_evidence(
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence_sources(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('DERIVED_FROM','VALIDATES','INVALIDATES','APPLIES_TO_VERSION')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(claim_id, evidence_id, kind)
) STRICT;

CREATE TABLE claim_relations(
  source_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('SUPERSEDES','CONFLICTS_WITH','DUPLICATE_OF','REQUIRES','USED_SKILL','SOLVED_BY','PROMOTED_TO','PORTFOLIO_PATTERN_OF')),
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_id, target_id, kind)
) STRICT;

-- FTS5：external-content + 触发器同步
CREATE VIRTUAL TABLE claims_fts USING fts5(searchable_text, content='claims', content_rowid='rowid');
CREATE TRIGGER claims_ai AFTER INSERT ON claims BEGIN
  INSERT INTO claims_fts(rowid, searchable_text) VALUES (new.rowid, new.searchable_text);
END;
CREATE TRIGGER claims_ad AFTER DELETE ON claims BEGIN
  INSERT INTO claims_fts(claims_fts, rowid, searchable_text) VALUES('delete', old.rowid, old.searchable_text);
END;
CREATE TRIGGER claims_au AFTER UPDATE ON claims BEGIN
  INSERT INTO claims_fts(claims_fts, rowid, searchable_text) VALUES('delete', old.rowid, old.searchable_text);
  INSERT INTO claims_fts(rowid, searchable_text) VALUES (new.rowid, new.searchable_text);
END;

-- 向量（P4 才启用）：派生索引，可整体重建；备份可不含向量
CREATE TABLE embeddings(
  claim_id TEXT PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  encoding TEXT NOT NULL, normalization TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  generated_at TEXT NOT NULL, batch_id TEXT,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','rebuilding','retired'))
) STRICT;

-- 自动候选幂等键：HMR/resume/崩溃重试不产生重复候选；候选到期删除不被外键阻止
CREATE TABLE candidate_idempotency(
  idempotency_key TEXT PRIMARY KEY,  -- project_id|session_id|turn_seq|extractor_version|candidate_index
  claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  original_claim_hash TEXT,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','expired','rejected','promoted')),
  expires_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- 召回审计：默认脱敏，不存完整 query
CREATE TABLE recall_runs(
  id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT,
  query_hash TEXT NOT NULL, query_class TEXT, query_len INTEGER,
  injected_bytes INTEGER, latency_ms INTEGER,
  created_at TEXT NOT NULL, expires_at TEXT
) STRICT;
-- 注意：claim_id 不放进主键——SQLite 主键列隐式 NOT NULL，会挡住 ON DELETE SET NULL
CREATE TABLE recall_items(
  recall_id TEXT NOT NULL REFERENCES recall_runs(id) ON DELETE CASCADE,
  claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  rank INTEGER NOT NULL, score REAL, reasons TEXT,
  injected INTEGER NOT NULL DEFAULT 0,
  UNIQUE(recall_id, claim_id)
) STRICT;

CREATE TABLE promotion_events(
  id TEXT PRIMARY KEY, claim_id TEXT NOT NULL,
  decision TEXT NOT NULL,           -- promote_skill|propose_agents|propose_system|propose_gate|archive|keep
  target TEXT, reviewer TEXT, rationale TEXT, created_at TEXT NOT NULL
) STRICT;

-- 删除证明：只留不可逆 id/hash/时间/原因，不留原文
CREATE TABLE tombstones(
  id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
  content_hash TEXT, deleted_at TEXT NOT NULL, reason TEXT NOT NULL
) STRICT;

CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO meta(key, value) VALUES ('schemaVersion', '1');

-- =====================================================================
-- 删除语义对照表（claims 物理删除，同一事务内）：
--   写 tombstone → claims_fts 触发器同步删除 → embeddings CASCADE
--   → claim_evidence CASCADE（evidence_sources 保留，孤儿由维护任务清理）
--   → claim_relations 两侧 CASCADE → recall_items.claim_id SET NULL
--   → candidate_idempotency.claim_id SET NULL（幂等键与 outcome 保留）
--   → superseded_by SET NULL。任何一步失败整体回滚。
-- =====================================================================
