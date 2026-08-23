CREATE TABLE import_job_issues (
  import_job_issue_id TEXT PRIMARY KEY CHECK (
    length(import_job_issue_id) = 40
    AND import_job_issue_id GLOB 'jis_????????-????-7???-[89ab]???-????????????'
  ),
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE RESTRICT,
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

CREATE INDEX import_job_issues_job_status_idx
  ON import_job_issues(import_job_id, status, severity, import_job_issue_id);

-- Windows paths are case-insensitive for Project Control identity. Creating
-- these indexes deliberately fails if an existing database contains a
-- case-only duplicate; migrateDatabase keeps the pre-v4 backup and rolls the
-- migration back instead of deleting or silently choosing either record.
CREATE UNIQUE INDEX project_source_roots_normalized_path_nocase_unique
  ON project_source_roots(normalized_path COLLATE NOCASE);

CREATE UNIQUE INDEX workspace_locations_active_path_nocase_unique
  ON workspace_locations(normalized_path COLLATE NOCASE)
  WHERE is_active = 1;
