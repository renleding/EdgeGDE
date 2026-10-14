-- ============================================================
-- 0023: align config_apply_run / config_apply_outcome with the
--        columns the apply sweep actually writes.
--
-- Migration 0016 created these tables with `scope_id`,
-- `initiated_by`, and status 'pending' — but the apply sweep
-- (config-apply.ts) writes `scope_kind`, `operator`,
-- `created_at`, and status 'running'. The INSERT therefore
-- failed with "table config_apply_run has no column named
-- scope_kind", turning every canaried apply into an HTTP 500
-- and leaving config_apply_run permanently empty — so the
-- first production apply could never be evidenced (R-07).
--
-- SQLite cannot rename/drop columns inside ALTER TABLE on
-- older runtimes, so: create corrected staging tables, copy
-- data (empty at first run — no successful apply has landed),
-- drop the old tables, rename the new ones.
-- ============================================================

CREATE TABLE config_apply_run_v2 (
  run_id        TEXT PRIMARY KEY,
  scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('global','group','vehicle')),
  operator      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running','canary','canary_failed','rolling','completed','failed','halted')),
  canary_vin    TEXT,
  canary_state  TEXT,      -- the specific condition that failed, when it did
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  created_at    TEXT,
  note          TEXT
);

CREATE TABLE config_apply_outcome_v2 (
  run_id             TEXT NOT NULL REFERENCES config_apply_run_v2 (run_id) ON DELETE CASCADE,
  vin                TEXT NOT NULL,
  outcome            TEXT NOT NULL CHECK (outcome IN ('applied','verified','skipped','failed','halted')),
  skip_reason        TEXT,   -- reuses the F02-R11 vocabulary (missing_key, ...)
  error_detail       TEXT,
  has_config         INTEGER,
  synced             INTEGER,
  observed_after     INTEGER,   -- did a telemetry observation follow?
  applied_at         TEXT,
  created_at         TEXT,
  PRIMARY KEY (run_id, vin)
);

-- 0016 created these tables but no successful apply ever landed,
-- so they are empty. Copy anyway in case a partial row exists.
INSERT INTO config_apply_run_v2 (run_id, scope_kind, operator, status, canary_vin, canary_state, started_at, finished_at, created_at, note)
  SELECT run_id, 'vehicle', initiated_by, status, canary_vin, canary_state, started_at, finished_at, started_at, note
    FROM config_apply_run;

INSERT INTO config_apply_outcome_v2 (run_id, vin, outcome, skip_reason, error_detail, has_config, synced, observed_after, applied_at, created_at)
  SELECT run_id, vin, outcome, skip_reason, error_detail, has_config, synced, observed_after, applied_at, applied_at
    FROM config_apply_outcome;

DROP TABLE config_apply_outcome;
DROP TABLE config_apply_run;

ALTER TABLE config_apply_run_v2 RENAME TO config_apply_run;
ALTER TABLE config_apply_outcome_v2 RENAME TO config_apply_outcome;
