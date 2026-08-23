-- Gate 2D: durable journal for controlled project file sync plans.
-- A plan row is created at prepare time and drives the staged write ->
-- atomic rename -> re-verify -> database acceptance pipeline. Terminal
-- states are accepted/rolled_back; recovery_required marks plans that need
-- human attention after an incomplete rollback or a hash mismatch.

CREATE TABLE file_sync_plans (
  plan_id TEXT PRIMARY KEY CHECK (
    length(plan_id) = 40
    AND plan_id GLOB 'pln_????????-????-7???-[89ab]???-????????????'
  ),
  command_id TEXT NOT NULL CHECK (
    length(command_id) = 40
    AND command_id GLOB 'cmd_????????-????-7???-[89ab]???-????????????'
  ),
  kind TEXT NOT NULL CHECK (kind IN ('create_from_template', 'upgrade_managed')),
  project_id TEXT NOT NULL CHECK (
    length(project_id) = 40
    AND project_id GLOB 'prj_????????-????-7???-[89ab]???-????????????'
  ),
  sync_policy TEXT NOT NULL CHECK (sync_policy IN ('atomic_create', 'atomic_additive')),
  target_display_path TEXT NOT NULL CHECK (length(target_display_path) BETWEEN 1 AND 2048),
  target_normalized_path TEXT NOT NULL CHECK (length(target_normalized_path) BETWEEN 1 AND 2048),
  staging_display_path TEXT NOT NULL CHECK (length(staging_display_path) BETWEEN 1 AND 2048),
  plan_hash TEXT NOT NULL CHECK (
    length(plan_hash) = 71
    AND substr(plan_hash, 1, 7) = 'sha256:'
    AND substr(plan_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  manifest_hash TEXT NOT NULL CHECK (
    length(manifest_hash) = 71
    AND substr(manifest_hash, 1, 7) = 'sha256:'
    AND substr(manifest_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL DEFAULT 'planned' CHECK (
    state IN (
      'planned', 'staging', 'staged', 'files_committed',
      'accepted', 'rolled_back', 'recovery_required'
    )
  ),
  operations_json TEXT NOT NULL CHECK (
    json_valid(operations_json) AND length(operations_json) <= 262144
  ),
  created_paths_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(created_paths_json) AND length(created_paths_json) <= 65536
  ),
  root_preexisted_empty INTEGER NOT NULL DEFAULT 0 CHECK (root_preexisted_empty IN (0, 1)),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX file_sync_plans_state_idx
  ON file_sync_plans(state, created_at);

CREATE INDEX file_sync_plans_command_idx
  ON file_sync_plans(command_id);
