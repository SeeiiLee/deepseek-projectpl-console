CREATE TABLE project_source_roots (
  source_root_id TEXT PRIMARY KEY CHECK (
    length(source_root_id) = 40
    AND source_root_id GLOB 'src_????????-????-7???-[89ab]???-????????????'
  ),
  kind TEXT NOT NULL CHECK (kind IN ('source_root', 'single_project')),
  display_path TEXT NOT NULL CHECK (length(display_path) BETWEEN 1 AND 2048),
  normalized_path TEXT NOT NULL UNIQUE CHECK (length(normalized_path) BETWEEN 1 AND 2048),
  scan_preferences_json TEXT NOT NULL CHECK (
    json_valid(scan_preferences_json) AND length(scan_preferences_json) <= 65536
  ),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE import_jobs (
  import_job_id TEXT PRIMARY KEY CHECK (
    length(import_job_id) = 40
    AND import_job_id GLOB 'job_????????-????-7???-[89ab]???-????????????'
  ),
  source_root_id TEXT NOT NULL REFERENCES project_source_roots(source_root_id) ON DELETE RESTRICT,
  root_path_snapshot TEXT NOT NULL CHECK (length(root_path_snapshot) BETWEEN 1 AND 2048),
  root_normalized_path_snapshot TEXT NOT NULL
    CHECK (length(root_normalized_path_snapshot) BETWEEN 1 AND 2048),
  scan_preferences_snapshot_json TEXT NOT NULL CHECK (
    json_valid(scan_preferences_snapshot_json)
    AND length(scan_preferences_snapshot_json) <= 65536
  ),
  mode TEXT NOT NULL CHECK (mode IN ('source_root', 'single_project')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
  scanner_version TEXT NOT NULL CHECK (length(scanner_version) BETWEEN 1 AND 100),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json) AND length(summary_json) <= 65536)
) STRICT;

CREATE INDEX import_jobs_source_root_started_idx
  ON import_jobs(source_root_id, started_at DESC, import_job_id DESC);

CREATE TABLE import_candidates (
  candidate_id TEXT PRIMARY KEY CHECK (
    length(candidate_id) = 40
    AND candidate_id GLOB 'can_????????-????-7???-[89ab]???-????????????'
  ),
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE RESTRICT,
  source_root_id TEXT NOT NULL REFERENCES project_source_roots(source_root_id) ON DELETE RESTRICT,
  root_display_path TEXT NOT NULL CHECK (length(root_display_path) BETWEEN 1 AND 2048),
  root_normalized_path TEXT NOT NULL CHECK (length(root_normalized_path) BETWEEN 1 AND 2048),
  detected_mode TEXT NOT NULL CHECK (detected_mode IN ('unknown', 'linked_legacy', 'managed')),
  manifest_project_id TEXT,
  suggested_name TEXT CHECK (suggested_name IS NULL OR length(suggested_name) BETWEEN 1 AND 200),
  suggested_summary TEXT CHECK (suggested_summary IS NULL OR length(suggested_summary) BETWEEN 1 AND 2000),
  summary_source TEXT CHECK (summary_source IS NULL OR length(summary_source) BETWEEN 1 AND 512),
  confidence_json TEXT NOT NULL CHECK (
    json_valid(confidence_json) AND length(confidence_json) <= 16384
  ),
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'conflict', 'relocation_candidate', 'ignored', 'imported')),
  status_before_ignored TEXT CHECK (
    status_before_ignored IS NULL
    OR status_before_ignored IN ('discovered', 'conflict', 'relocation_candidate')
  ),
  matched_project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (import_job_id, root_normalized_path),
  CHECK (
    (status = 'imported' AND matched_project_id IS NOT NULL)
    OR (status <> 'imported' AND matched_project_id IS NULL)
  ),
  CHECK (
    (status = 'ignored' AND status_before_ignored IS NOT NULL)
    OR (status <> 'ignored' AND status_before_ignored IS NULL)
  )
) STRICT;

CREATE INDEX import_candidates_source_status_idx
  ON import_candidates(source_root_id, status, candidate_id);

CREATE INDEX import_candidates_job_idx
  ON import_candidates(import_job_id, candidate_id);

CREATE TABLE import_candidate_documents (
  candidate_document_id TEXT PRIMARY KEY CHECK (
    length(candidate_document_id) = 40
    AND candidate_document_id GLOB 'doc_????????-????-7???-[89ab]???-????????????'
  ),
  candidate_id TEXT NOT NULL REFERENCES import_candidates(candidate_id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 512),
  suggested_role TEXT CHECK (
    suggested_role IS NULL
    OR suggested_role IN (
      'readme', 'prd', 'devlog', 'progress', 'next',
      'current_architecture', 'decision', 'other'
    )
  ),
  sha256 TEXT CHECK (
    sha256 IS NULL
    OR (length(sha256) = 71 AND substr(sha256, 1, 7) = 'sha256:'
      AND substr(sha256, 8) NOT GLOB '*[^0-9a-f]*')
  ),
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 500),
  preview TEXT CHECK (preview IS NULL OR length(preview) BETWEEN 1 AND 1000),
  observed_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND length(evidence_json) <= 16384),
  UNIQUE (candidate_id, relative_path)
) STRICT;

CREATE INDEX import_candidate_documents_candidate_role_idx
  ON import_candidate_documents(candidate_id, suggested_role, relative_path);

CREATE TABLE import_issues (
  import_issue_id TEXT PRIMARY KEY CHECK (
    length(import_issue_id) = 40
    AND import_issue_id GLOB 'iss_????????-????-7???-[89ab]???-????????????'
  ),
  candidate_id TEXT NOT NULL REFERENCES import_candidates(candidate_id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 100),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'blocking')),
  details_json TEXT NOT NULL CHECK (json_valid(details_json) AND length(details_json) <= 16384),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at TEXT,
  CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX import_issues_candidate_status_idx
  ON import_issues(candidate_id, status, severity, import_issue_id);

CREATE TABLE intake_location_refs (
  location_ref TEXT PRIMARY KEY CHECK (
    length(location_ref) = 40
    AND location_ref GLOB 'loc_????????-????-7???-[89ab]???-????????????'
  ),
  candidate_id TEXT NOT NULL REFERENCES import_candidates(candidate_id) ON DELETE RESTRICT,
  source_root_id TEXT NOT NULL REFERENCES project_source_roots(source_root_id) ON DELETE RESTRICT,
  application_instance_id TEXT NOT NULL
    CHECK (length(application_instance_id) BETWEEN 1 AND 200),
  scope TEXT NOT NULL CHECK (scope = 'project-control.lifecycle'),
  display_path TEXT NOT NULL CHECK (length(display_path) BETWEEN 1 AND 2048),
  normalized_path TEXT NOT NULL CHECK (length(normalized_path) BETWEEN 1 AND 2048),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX intake_location_refs_candidate_idx
  ON intake_location_refs(candidate_id, expires_at);

CREATE TABLE intake_source_root_refs (
  source_root_ref TEXT PRIMARY KEY CHECK (
    length(source_root_ref) = 40
    AND source_root_ref GLOB 'srt_????????-????-7???-[89ab]???-????????????'
  ),
  candidate_id TEXT NOT NULL REFERENCES import_candidates(candidate_id) ON DELETE RESTRICT,
  source_root_id TEXT NOT NULL REFERENCES project_source_roots(source_root_id) ON DELETE RESTRICT,
  application_instance_id TEXT NOT NULL
    CHECK (length(application_instance_id) BETWEEN 1 AND 200),
  scope TEXT NOT NULL CHECK (scope = 'project-control.lifecycle'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX intake_source_root_refs_candidate_idx
  ON intake_source_root_refs(candidate_id, expires_at);
