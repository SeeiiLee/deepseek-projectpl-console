CREATE TABLE project_document_bindings (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  role TEXT NOT NULL
    CHECK (role IN ('readme', 'prd', 'devlog', 'progress', 'next', 'current_architecture', 'decision', 'other')),
  relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 512),
  content_hash TEXT,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('user_confirmed', 'manifest')),
  confirmed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  PRIMARY KEY (project_id, role, relative_path),
  CHECK (
    content_hash IS NULL
    OR (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'
      AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*')
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE project_manifest_mirrors (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE RESTRICT,
  protocol_version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE CHECK (
    length(manifest_hash) = 71 AND substr(manifest_hash, 1, 7) = 'sha256:'
    AND substr(manifest_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  origin_json TEXT NOT NULL CHECK (json_valid(origin_json)),
  document_bindings_json TEXT NOT NULL CHECK (json_valid(document_bindings_json)),
  verified_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
) STRICT;
