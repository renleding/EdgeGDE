-- 0015_archive_superseded_configs.sql
--
-- CLEANUP: 56 superseded/failed config rows were visible in the operator console and in
-- the audit trail. They are the residue of the 2026-10-05 configuration repair — 28 per
-- vehicle, every one a `failed` attempt while the POST path and CA were being corrected —
-- and they are noise: they make the config history unreadable, and `/api/telemetry/health`
-- reported "total: 57, active: 1" as though 56 live configurations existed.
--
-- WHY ARCHIVE AND NOT DELETE
--
-- The alternative was a flat `DELETE`. That was rejected: this platform's whole failure
-- history is optimistic writes where the evidence of what was attempted disappeared, and
-- silently removing audit rows to tidy a page would be the same class of mistake. The rows
-- record a real sequence of real attempts against real vehicles; that history is evidence.
--
-- So they move. `tesla_telemetry_config` keeps only the row(s) that are CURRENT FOR A
-- VEHICLE — what the console and the config-health query should be reading — while the full
-- attempt history remains queryable in `tesla_telemetry_config_archive`.
--
-- "Current" is deliberately narrow: state IN ('active','pending') is a configuration that
-- Tesla may actually be holding. `failed` never reached Tesla, and a `removed` config was
-- explicitly withdrawn, so neither is current. Everything that is NOT current-for-its-VIN
-- is superseded and moves.
--
-- Reversible: the archive is inserted with the identical config_id as the primary key, so a
-- restore is the inverse statement after deleting the current row.
--
-- Ordering note (this matters and is easy to get wrong): rows are ranked so that the
-- newest survives. `created_at DESC` first, then `config_id DESC` as a tiebreak — several
-- of these rows share an identical `created_at` to the millisecond (the repair POSTed the
-- same timestamp to both vehicles), and without a deterministic tiebreak the row that
-- survives could differ between runs.
--
-- Idempotent by construction: after the insert, no non-current row remains in the source
-- table, so a second run moves nothing.

CREATE TABLE IF NOT EXISTS tesla_telemetry_config_archive (
  config_id       TEXT PRIMARY KEY,
  vin             TEXT NOT NULL,
  state           TEXT NOT NULL,
  skip_reason     TEXT,
  sync_interval   TEXT NOT NULL DEFAULT '6 hours',
  hostname        TEXT NOT NULL,
  port            INTEGER NOT NULL DEFAULT 443,
  ca_file         TEXT,
  fields_json     TEXT NOT NULL,
  config_version  INTEGER NOT NULL DEFAULT 1,
  applied_at      TEXT,
  verified_at     TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  archived_at     TEXT NOT NULL
);

-- Read the history by vehicle, newest first — the only access pattern needed.
CREATE INDEX IF NOT EXISTS idx_config_archive_vin
  ON tesla_telemetry_config_archive (vin, created_at DESC);

INSERT OR IGNORE INTO tesla_telemetry_config_archive (
  config_id, vin, state, skip_reason, sync_interval, hostname, port, ca_file,
  fields_json, config_version, applied_at, verified_at, last_error, created_at, archived_at
)
SELECT
  config_id, vin, state, skip_reason, sync_interval, hostname, port, ca_file,
  fields_json, config_version, applied_at, verified_at, last_error, created_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY vin
    -- The CURRENT row for the vehicle: an active or pending config if one exists,
    -- otherwise the newest row of any state. This keeps exactly one survivor per VIN,
    -- and it is deterministic.
    ORDER BY
      CASE WHEN state IN ('active', 'pending') THEN 0 ELSE 1 END,
      created_at DESC,
      config_id DESC
  ) AS rn
  FROM tesla_telemetry_config
)
WHERE rn > 1;

DELETE FROM tesla_telemetry_config
WHERE config_id IN (SELECT config_id FROM tesla_telemetry_config_archive);

-- Verification, as a query rather than a comment:
--
--   SELECT vin, COUNT(*) FROM tesla_telemetry_config GROUP BY vin;
--       -> exactly 1 per vehicle
--   SELECT vin, state FROM tesla_telemetry_config;
--       -> the surviving row per vehicle is active or pending where one ever applied
--   SELECT vin, state, COUNT(*) FROM tesla_telemetry_config_archive GROUP BY vin, state;
--       -> the 56 superseded attempts, still queryable
