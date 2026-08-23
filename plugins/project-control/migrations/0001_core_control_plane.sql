CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL,
  app_version TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('linked_legacy', 'managed')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('imported', 'template', 'fork')),
  template_id TEXT,
  template_version TEXT,
  forked_from_project_id TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'paused', 'archived', 'needs_attention')),
  health TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health IN ('unknown', 'healthy', 'at_risk', 'blocked', 'needs_attention')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (
    (origin_kind = 'imported' AND template_id IS NULL AND template_version IS NULL AND forked_from_project_id IS NULL)
    OR (origin_kind = 'template' AND template_id IS NOT NULL AND template_version IS NOT NULL AND forked_from_project_id IS NULL)
    OR (origin_kind = 'fork' AND template_id IS NULL AND template_version IS NULL AND forked_from_project_id IS NOT NULL)
  ),
  UNIQUE (project_id, revision)
) STRICT;

CREATE TABLE workspace_locations (
  location_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('primary', 'mirror', 'archive')),
  display_path TEXT NOT NULL CHECK (length(display_path) > 0),
  normalized_path TEXT NOT NULL CHECK (length(normalized_path) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  verified_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, location_id)
) STRICT;

CREATE UNIQUE INDEX workspace_locations_active_path_unique
  ON workspace_locations(normalized_path)
  WHERE is_active = 1;

CREATE UNIQUE INDEX workspace_locations_project_kind_active_unique
  ON workspace_locations(project_id, kind)
  WHERE is_active = 1;

CREATE TABLE project_path_history (
  history_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  old_path TEXT NOT NULL,
  new_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER project_path_history_no_update
BEFORE UPDATE ON project_path_history BEGIN
  SELECT RAISE(ABORT, 'project_path_history is append-only');
END;

CREATE TRIGGER project_path_history_no_delete
BEFORE DELETE ON project_path_history BEGIN
  SELECT RAISE(ABORT, 'project_path_history is append-only');
END;

CREATE TABLE work_items (
  work_item_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  instruction TEXT,
  acceptance_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_json)),
  execution_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (execution_status IN ('draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled')),
  review_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (review_status IN ('not_requested', 'pending', 'changes_requested', 'approved', 'rejected')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (project_id, work_item_id)
) STRICT;

CREATE TABLE command_receipts (
  command_id TEXT PRIMARY KEY,
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  actor_ref TEXT NOT NULL CHECK (json_valid(actor_ref)),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  result_json TEXT,
  error_json TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (idempotency_scope, idempotency_key),
  CHECK (
    (status = 'accepted' AND result_json IS NOT NULL AND error_json IS NULL)
    OR (status = 'rejected' AND result_json IS NOT NULL AND error_json IS NOT NULL)
  )
) STRICT;

CREATE TRIGGER command_receipts_no_update
BEFORE UPDATE ON command_receipts BEGIN
  SELECT RAISE(ABORT, 'command_receipts is append-only');
END;

CREATE TRIGGER command_receipts_no_delete
BEFORE DELETE ON command_receipts BEGIN
  SELECT RAISE(ABORT, 'command_receipts is append-only');
END;

CREATE TABLE event_sequence (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_value INTEGER NOT NULL CHECK (last_value >= 0)
) STRICT;

INSERT INTO event_sequence(singleton, last_value) VALUES (1, 0);

CREATE TABLE domain_events (
  event_id TEXT PRIMARY KEY,
  global_sequence INTEGER NOT NULL UNIQUE CHECK (global_sequence > 0),
  project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('project', 'work_item')),
  aggregate_id TEXT NOT NULL,
  before_revision INTEGER NOT NULL CHECK (before_revision >= 0),
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision = before_revision + 1),
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  actor_ref TEXT NOT NULL CHECK (json_valid(actor_ref)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(command_id) ON DELETE RESTRICT,
  correlation_id TEXT,
  causation_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (aggregate_type, aggregate_id, aggregate_revision)
) STRICT;

CREATE INDEX domain_events_project_sequence_idx
  ON domain_events(project_id, global_sequence);

CREATE TRIGGER domain_events_no_update
BEFORE UPDATE ON domain_events BEGIN
  SELECT RAISE(ABORT, 'domain_events is append-only');
END;

CREATE TRIGGER domain_events_no_delete
BEFORE DELETE ON domain_events BEGIN
  SELECT RAISE(ABORT, 'domain_events is append-only');
END;

CREATE TABLE outbox_messages (
  outbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES domain_events(event_id) ON DELETE RESTRICT,
  destination TEXT NOT NULL,
  message_key TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatching', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, destination, message_key)
) STRICT;

CREATE INDEX outbox_messages_dispatch_idx
  ON outbox_messages(status, next_attempt_at, created_at);
