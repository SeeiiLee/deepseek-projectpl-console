-- 0003_embedding_jobs.sql — P4-2：嵌入作业状态机（pending/ready/failed/stale）。
-- 只改分片库；catalog 无变更（与 0002 同套路，catalog 半为空、版本号随迁移统一 +1）。
-- 约定：embeddings 表存最终向量（active/rebuilding/retired），本表存逐 claim 的作业状态与重试计数；
--       失败只记错误码，不记正文。
-- v1 的 embeddings.generation 是 INTEGER（默认 1），P4 需要语义合同哈希字符串，故整表重建为 TEXT generation。

-- 第一部分：catalog 无变更

-- 第二部分：
CREATE TABLE embeddings_p4(
  claim_id TEXT PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  encoding TEXT NOT NULL, normalization TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  generated_at TEXT NOT NULL, batch_id TEXT,
  generation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','rebuilding','retired'))
) STRICT;
INSERT INTO embeddings_p4(claim_id, provider_id, model_id, model_revision, dimensions, encoding, normalization, content_hash, vector_blob, generated_at, batch_id, generation, status)
  SELECT claim_id, provider_id, model_id, model_revision, dimensions, encoding, normalization, content_hash, vector_blob, generated_at, batch_id, CAST(generation AS TEXT), status FROM embeddings;
DROP TABLE embeddings;
ALTER TABLE embeddings_p4 RENAME TO embeddings;

CREATE TABLE embedding_jobs(
  claim_id TEXT PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','failed','stale')),
  error_code TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_embedding_jobs_state ON embedding_jobs(state, updated_at);
