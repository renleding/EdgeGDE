-- ============================================================
-- 0023: align config_apply_run / config_apply_outcome with
--        the columns the apply sweep actually writes.
--
-- Migration 0016 created config_apply_run with scope_id,
-- initiated_by, and status 'pending' — but the apply sweep
-- (config-apply.ts:287) writes scope_kind, operator,
-- created_at, and status 'running'. Every canaried apply
-- therefore failed with 'table config_apply_run has no
-- column named scope_kind', surfaced as HTTP 500, and
-- config_apply_run stayed empty — so the first production
-- apply could never be evidenced (R-07).
--
-- The status CHECK must be rebuilt because SQLite enforces
-- CHECK on write: the old constraint ('pending','canary',...)
-- rejects the sweep's 'running' value. SQLite cannot ALTER a
-- CHECK constraint, so the table is rebuilt: create the
-- corrected table, copy rows, drop the old, rename.
-- verify-schema.sh counts net tables (CREATE minus DROP),
-- so the staging table does not desync the count.
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

-- 0016 created this table but no successful apply ever landed,
-- so it is empty. Copy anyway in case a partial row exists.
INSERT INTO config_apply_run_v2
  (run_id, scope_kind, operator, status, canary_vin, canary_state, started_at, finished_at, created_at, note)
  SELECT
    run_id,
    COALESCE(NULLIF(scope_id, ''), 'vehicle'),   -- 0016's scope_id was a FK; the sweep writes scope_kind directly
    initiated_by,
    status,
    canary_vin,
    canary_state,
    started_at,
    finished_at,
    started_at,                                   -- created_at unknown pre-migration; backfill from started_at
    note
  FROM config_apply_run;

DROP TABLE config_apply_run;
ALTER TABLE config_apply_run_v2 RENAME TO config_apply_run;

-- config_apply_outcome: + created_at (the sweep stamps it)
ALTER TABLE config_apply_outcome ADD COLUMN created_at TEXT;
