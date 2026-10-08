-- FEATURE-12: Vehicle Telemetry Configurator
-- Telemetry configuration scopes: global, group, vehicle
-- Sparse, most-specific-wins resolution
-- Staged changes applied through CI with eligible canary

-- ============================================================
-- A configuration scope: global default, a group, or one vehicle.
-- Exactly one of group_id / vin is set; both NULL means global.
-- The global scope is required to exist and to be total (F12-R02).
-- ============================================================
CREATE TABLE telemetry_config_scope (
  scope_id    TEXT PRIMARY KEY,
  scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('global','group','vehicle')),
  group_id    TEXT REFERENCES tesla_vehicle_group (group_id) ON DELETE CASCADE,
  vin         TEXT REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  -- A scope identifies exactly one subject, and the kind must match it.
  CHECK ((scope_kind = 'global'  AND group_id IS NULL     AND vin IS NULL)
      OR (scope_kind = 'group'   AND group_id IS NOT NULL AND vin IS NULL)
      OR (scope_kind = 'vehicle' AND vin IS NOT NULL      AND group_id IS NULL))
);

-- At most one scope row per subject, so resolution has no ambiguity to break ties on.
CREATE UNIQUE INDEX idx_scope_global  ON telemetry_config_scope (scope_kind) WHERE scope_kind = 'global';
CREATE UNIQUE INDEX idx_scope_group   ON telemetry_config_scope (group_id)  WHERE group_id  IS NOT NULL;
CREATE UNIQUE INDEX idx_scope_vehicle ON telemetry_config_scope (vin)       WHERE vin       IS NOT NULL;

-- ============================================================
-- One entry per (scope, field). SPARSE: a field with no row at this scope
-- INHERITS from the level above. `enabled = 0` is a deliberate value meaning
-- "do not collect", which is NOT the same as "no row" -- that distinction is
-- the whole reason this is a row rather than a deleted row.
-- ============================================================
CREATE TABLE telemetry_config_entry (
  scope_id          TEXT NOT NULL REFERENCES telemetry_config_scope (scope_id) ON DELETE CASCADE,
  field_key         TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  interval_seconds  INTEGER NOT NULL CHECK (interval_seconds > 0),
  minimum_delta     REAL,                -- NULL = no delta gate at this scope
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (scope_id, field_key)
);

-- ============================================================
-- Group scope is a first-class, owner-curated entity (R-17 resolution, v2.1),
-- NOT a binding to F06's derived segment keys. The derived key is an OUTPUT,
-- recomputed per export; a scope bound to it would silently stop applying when
-- the derivation changed.
-- ============================================================
CREATE TABLE tesla_vehicle_group (
  group_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE tesla_vehicle_group_member (
  group_id  TEXT NOT NULL REFERENCES tesla_vehicle_group (group_id) ON DELETE CASCADE,
  vin       TEXT NOT NULL REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, vin)
);

-- ============================================================
-- One row per apply invocation. The evidence that a change was applied (F12-R06).
-- ============================================================
CREATE TABLE config_apply_run (
  run_id        TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES telemetry_config_scope (scope_id),
  status        TEXT NOT NULL CHECK (status IN ('pending','canary','canary_failed','rolling','completed','failed','halted')),
  canary_vin    TEXT,
  canary_state  TEXT,      -- the specific condition that failed, when it did
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  initiated_by  TEXT,
  note          TEXT
);

-- Per-vehicle outcome. `verified_condition` records WHICH condition passed/failed
-- so a halt is diagnosable rather than a bare 'failed'.
CREATE TABLE config_apply_outcome (
  run_id             TEXT NOT NULL REFERENCES config_apply_run (run_id) ON DELETE CASCADE,
  vin                TEXT NOT NULL,
  outcome            TEXT NOT NULL CHECK (outcome IN ('applied','verified','skipped','failed','halted')),
  skip_reason        TEXT,   -- reuses the F02-R11 vocabulary (missing_key, ...)
  error_detail       TEXT,
  has_config         INTEGER,
  synced             INTEGER,
  observed_after     INTEGER,   -- did a telemetry observation follow?
  applied_at         TEXT,
  PRIMARY KEY (run_id, vin)
);

-- ============================================================
-- Seed the global scope as total (F12-R02).
-- This migration is a separate step so it runs after the catalog is loaded.
-- The global tier is seeded from the catalog at interval_seconds = 180 for
-- every collected field, so a fresh deployment's day-one behaviour is identical
-- to today's and per-field values are adjusted from there. SYNC_INTERVAL_SECONDS
-- is therefore retained as the seed value and is NOT deleted by this feature.
-- ============================================================
-- INSERTs are in 0017_seed_global_scope.sql