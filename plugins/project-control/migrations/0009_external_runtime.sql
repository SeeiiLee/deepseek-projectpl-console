-- Gate 2E (P6): external runtime pipeline foundation.
-- 1) Widen domain_events.aggregate_type to include 'run' via the standard
--    SQLite rename-and-rebuild recipe (deferred FKs keep outbox consistent).
-- 2) Add runs/thread bindings/reviews/decisions/progress updates/host
--    instances/quarantine. work_items itself stays frozen from 0001.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE domain_events RENAME TO domain_events_v8;
ALTER TABLE outbox_messages RENAME TO outbox_messages_v8;

CREATE TABLE domain_events (
  event_id TEXT PRIMARY KEY,
  global_sequence INTEGER NOT NULL UNIQUE CHECK (global_sequence > 0),
  project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('project', 'work_item', 'run')),
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

INSERT INTO domain_events(
  event_id, global_sequence, project_id, aggregate_type, aggregate_id,
  before_revision, aggregate_revision, event_type, schema_version, payload_json,
  actor_ref, provenance_json, command_id, correlation_id, causation_id,
  occurred_at, recorded_at
) SELECT
  event_id, global_sequence, project_id, aggregate_type, aggregate_id,
  before_revision, aggregate_revision, event_type, schema_version, payload_json,
  actor_ref, provenance_json, command_id, correlation_id, causation_id,
  occurred_at, recorded_at
FROM domain_events_v8;

INSERT INTO outbox_messages(
  outbox_id, event_id, destination, message_key, schema_version, payload_json,
  status, attempt_count, next_attempt_at, delivered_at, last_error,
  created_at, updated_at
) SELECT
  outbox_id, event_id, destination, message_key, schema_version, payload_json,
  status, attempt_count, next_attempt_at, delivered_at, last_error,
  created_at, updated_at
FROM outbox_messages_v8;

DROP TABLE outbox_messages_v8;
DROP TABLE domain_events_v8;

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

CREATE INDEX outbox_messages_dispatch_idx
  ON outbox_messages(status, next_attempt_at, created_at);

PRAGMA defer_foreign_keys = OFF;

CREATE TABLE host_instances (
  instance_id TEXT PRIMARY KEY CHECK (
    length(instance_id) BETWEEN 1 AND 127
    AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 64),
  protocol_versions_json TEXT NOT NULL CHECK (
    json_valid(protocol_versions_json) AND length(protocol_versions_json) <= 16384
  ),
  capabilities_json TEXT NOT NULL CHECK (
    json_valid(capabilities_json) AND length(capabilities_json) <= 16384
  ),
  heartbeat_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE work_item_dependencies (
  work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  depends_on_work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('blocks', 'relates_to')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_item_id, depends_on_work_item_id, kind),
  CHECK (work_item_id <> depends_on_work_item_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY CHECK (
    length(run_id) = 40
    AND run_id GLOB 'run_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'blocked', 'orphaned', 'cancelled')
  ),
  instruction_snapshot_json TEXT NOT NULL CHECK (
    json_valid(instruction_snapshot_json) AND length(instruction_snapshot_json) <= 16384
  ),
  acceptance_snapshot_json TEXT NOT NULL CHECK (
    json_valid(acceptance_snapshot_json) AND length(acceptance_snapshot_json) <= 16384
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX runs_work_item_idx ON runs(work_item_id, attempt_no DESC, run_id);

CREATE TABLE agent_thread_bindings (
  binding_id TEXT PRIMARY KEY CHECK (
    length(binding_id) = 40
    AND binding_id GLOB 'atb_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  harness_instance_ref TEXT NOT NULL CHECK (length(harness_instance_ref) BETWEEN 1 AND 127),
  session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 200),
  thread_id TEXT NOT NULL CHECK (
    length(thread_id) BETWEEN 1 AND 128 AND thread_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, thread_id),
  UNIQUE (project_id, run_id, harness_instance_ref)
) STRICT;

CREATE TABLE reviews (
  review_id TEXT PRIMARY KEY CHECK (
    length(review_id) = 40
    AND review_id GLOB 'rev_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  work_item_id TEXT REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  reviewed_work_item_revision INTEGER CHECK (
    reviewed_work_item_revision IS NULL OR reviewed_work_item_revision >= 1
  ),
  artifact_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(artifact_refs_json) AND length(artifact_refs_json) <= 16384
  ),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested', 'in_review', 'approved', 'rejected', 'superseded')
  ),
  risk TEXT NOT NULL DEFAULT 'unrated' CHECK (risk IN ('unrated', 'low', 'medium', 'high')),
  requested_by_json TEXT NOT NULL CHECK (
    json_valid(requested_by_json) AND length(requested_by_json) <= 8192
  ),
  decided_by_json TEXT CHECK (
    decided_by_json IS NULL
    OR (json_valid(decided_by_json) AND length(decided_by_json) <= 8192)
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (
    (status IN ('approved', 'rejected', 'superseded')
      AND decided_at IS NOT NULL AND decided_by_json IS NOT NULL)
    OR (status IN ('requested', 'in_review')
      AND decided_at IS NULL AND decided_by_json IS NULL)
  )
) STRICT;

CREATE TABLE review_actions (
  review_action_id TEXT PRIMARY KEY CHECK (
    length(review_action_id) = 40
    AND review_action_id GLOB 'rva_????????-????-7???-[89ab]???-????????????'
  ),
  review_id TEXT NOT NULL REFERENCES reviews(review_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (
    action IN ('comment', 'request_changes', 'approve', 'reject', 'supersede')
  ),
  actor_ref TEXT NOT NULL CHECK (json_valid(actor_ref) AND length(actor_ref) <= 8192),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 4000),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX review_actions_review_idx
  ON review_actions(review_id, created_at, review_action_id);

CREATE TABLE decisions (
  decision_id TEXT PRIMARY KEY CHECK (
    length(decision_id) = 40
    AND decision_id GLOB 'dec_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  work_item_id TEXT REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  context TEXT CHECK (context IS NULL OR length(context) <= 20000),
  options_json TEXT NOT NULL CHECK (
    json_valid(options_json) AND length(options_json) <= 16384
  ),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (
    status IN ('proposed', 'accepted', 'rejected', 'superseded')
  ),
  rationale TEXT CHECK (rationale IS NULL OR length(rationale) <= 4000),
  proposed_by_json TEXT NOT NULL CHECK (
    json_valid(proposed_by_json) AND length(proposed_by_json) <= 8192
  ),
  decided_by_json TEXT CHECK (
    decided_by_json IS NULL
    OR (json_valid(decided_by_json) AND length(decided_by_json) <= 8192)
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (
    (status IN ('accepted', 'rejected', 'superseded')
      AND decided_at IS NOT NULL AND decided_by_json IS NOT NULL)
    OR (status = 'proposed' AND decided_at IS NULL AND decided_by_json IS NULL)
  )
) STRICT;

CREATE TABLE progress_updates (
  progress_update_id TEXT PRIMARY KEY CHECK (
    length(progress_update_id) = 40
    AND progress_update_id GLOB 'upd_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  work_item_id TEXT REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  run_id TEXT REFERENCES runs(run_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'blocker', 'completion_declared')),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  needs_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(needs_json) AND length(needs_json) <= 16384
  ),
  acceptance_claims_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(acceptance_claims_json) AND length(acceptance_claims_json) <= 16384
  ),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json) AND length(evidence_json) <= 16384
  ),
  completion_percent INTEGER CHECK (
    completion_percent IS NULL OR (completion_percent BETWEEN 0 AND 100)
  ),
  details TEXT CHECK (details IS NULL OR length(details) <= 20000),
  thread_id TEXT CHECK (
    thread_id IS NULL
    OR (length(thread_id) BETWEEN 1 AND 128 AND thread_id NOT GLOB '*[^A-Za-z0-9._:-]*')
  ),
  source_event_id TEXT CHECK (
    source_event_id IS NULL
    OR (length(source_event_id) = 40
      AND source_event_id GLOB 'evt_????????-????-7???-[89ab]???-????????????')
  ),
  command_id TEXT NOT NULL CHECK (
    length(command_id) = 40
    AND command_id GLOB 'cmd_????????-????-7???-[89ab]???-????????????'
  ),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('work_item', 'run')),
  aggregate_id TEXT NOT NULL CHECK (length(aggregate_id) = 40),
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 2),
  generated_by_json TEXT NOT NULL CHECK (
    json_valid(generated_by_json) AND length(generated_by_json) <= 8192
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX progress_updates_project_idx
  ON progress_updates(project_id, created_at, progress_update_id);

CREATE INDEX progress_updates_work_item_idx
  ON progress_updates(work_item_id, created_at, progress_update_id);

CREATE INDEX progress_updates_run_idx
  ON progress_updates(run_id, created_at, progress_update_id);

CREATE TABLE quarantine_items (
  quarantine_id TEXT PRIMARY KEY CHECK (
    length(quarantine_id) = 40
    AND quarantine_id GLOB 'qtn_????????-????-7???-[89ab]???-????????????'
  ),
  project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 100),
  source_ref TEXT NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 512),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 100),
  payload_ref TEXT CHECK (payload_ref IS NULL OR length(payload_ref) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND length(details_json) <= 16384
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status IN ('resolved', 'ignored') AND resolved_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX quarantine_items_status_idx
  ON quarantine_items(status, created_at, quarantine_id);
