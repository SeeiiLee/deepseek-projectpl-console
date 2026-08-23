-- Gate 2D P3: plan-bound references for createFromTemplate and the
-- render parameters used to deterministically re-render a prepared plan.

ALTER TABLE file_sync_plans ADD COLUMN render_params_json TEXT CHECK (
  render_params_json IS NULL
  OR (json_valid(render_params_json) AND length(render_params_json) <= 4096)
);

CREATE TABLE file_sync_plan_refs (
  plan_ref TEXT PRIMARY KEY CHECK (
    length(plan_ref) = 40
    AND (plan_ref GLOB 'loc_????????-????-7???-[89ab]???-????????????'
      OR plan_ref GLOB 'srt_????????-????-7???-[89ab]???-????????????')
  ),
  ref_kind TEXT NOT NULL CHECK (ref_kind IN ('location', 'source_root')),
  plan_id TEXT NOT NULL REFERENCES file_sync_plans(plan_id) ON DELETE RESTRICT,
  application_instance_id TEXT NOT NULL
    CHECK (length(application_instance_id) BETWEEN 1 AND 200),
  scope TEXT NOT NULL CHECK (scope = 'project-control.lifecycle'),
  display_path TEXT NOT NULL CHECK (length(display_path) BETWEEN 1 AND 2048),
  normalized_path TEXT NOT NULL CHECK (length(normalized_path) BETWEEN 1 AND 2048),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX file_sync_plan_refs_plan_idx
  ON file_sync_plan_refs(plan_id, ref_kind);
