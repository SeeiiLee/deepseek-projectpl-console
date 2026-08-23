-- Gate 2D P5: per-binding document index states and human-confirmed
-- rebind proposals. No document content or body text is stored here: only
-- role/path, observed content hash, byte size and bounded parse diagnostics.
-- Document changes only form states/proposals and never auto-advance
-- WorkItem or Review aggregates (those live in later gates).

CREATE TABLE project_document_states (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  role TEXT NOT NULL
    CHECK (role IN ('readme', 'prd', 'devlog', 'progress', 'next', 'current_architecture', 'decision', 'other')),
  relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 512),
  binding_source TEXT NOT NULL CHECK (binding_source IN ('user_confirmed', 'manifest')),
  state TEXT NOT NULL CHECK (state IN ('ok', 'changed', 'missing', 'unreadable')),
  content_hash TEXT CHECK (
    content_hash IS NULL
    OR (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'
      AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*')
  ),
  byte_size INTEGER CHECK (byte_size IS NULL OR (byte_size >= 0 AND byte_size <= 67108864)),
  parse_issues_json TEXT NOT NULL CHECK (
    json_valid(parse_issues_json) AND length(parse_issues_json) <= 16384
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, role, relative_path),
  CHECK (
    (state IN ('ok', 'changed') AND content_hash IS NOT NULL)
    OR (state IN ('missing', 'unreadable') AND content_hash IS NULL AND byte_size IS NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX project_document_states_project_state_idx
  ON project_document_states(project_id, state);

CREATE TABLE project_document_rebind_proposals (
  proposal_id TEXT PRIMARY KEY CHECK (
    length(proposal_id) = 40
    AND proposal_id GLOB 'rbd_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  role TEXT NOT NULL
    CHECK (role IN ('readme', 'prd', 'devlog', 'progress', 'next', 'current_architecture', 'decision', 'other')),
  missing_relative_path TEXT NOT NULL CHECK (length(missing_relative_path) BETWEEN 1 AND 512),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'
    AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  candidate_relative_paths_json TEXT NOT NULL CHECK (
    json_valid(candidate_relative_paths_json)
    AND length(candidate_relative_paths_json) <= 16384
  ),
  candidate_count INTEGER NOT NULL CHECK (candidate_count BETWEEN 1 AND 50),
  unambiguous INTEGER NOT NULL CHECK (unambiguous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  resolved_relative_path TEXT CHECK (
    resolved_relative_path IS NULL OR length(resolved_relative_path) BETWEEN 1 AND 512
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (project_id, role, missing_relative_path),
  CHECK (
    (status = 'proposed' AND resolved_at IS NULL AND resolved_relative_path IS NULL)
    OR (status IN ('accepted', 'rejected', 'superseded') AND resolved_at IS NOT NULL)
  ),
  CHECK (
    (status = 'accepted' AND resolved_relative_path IS NOT NULL)
    OR (status <> 'accepted' AND resolved_relative_path IS NULL)
  )
) STRICT;

CREATE INDEX project_document_rebind_proposals_project_status_idx
  ON project_document_rebind_proposals(project_id, status);
