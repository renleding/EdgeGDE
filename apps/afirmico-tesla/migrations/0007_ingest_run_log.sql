-- FRS-010 F04-R10: collection run log.
--
-- Why this table did not exist
-- ----------------------------
-- The F08 schema (0001) modelled a *polling* collector: one run row per
-- scheduled sweep, with vehicles attempted/succeeded/failed. The transport was
-- then changed to Fleet Telemetry push (F04-R01), and the run log was never
-- re-modelled to match — so F04-R10, F04-R11 and F04 AC1/AC2/AC6 had no table
-- to write to.
--
-- Under push there is no sweep to log. The equivalent evidence is the ingest
-- *window*: what arrived, what was refused and why, and what it cost. That is
-- what this table records, because the failure mode worth catching is not a
-- failed run — it is a run that reports success while every vehicle has been
-- silently de-configured by a Tesla billing breach (R-07).

CREATE TABLE tesla_ingest_run (
  run_id              TEXT PRIMARY KEY,
  cadence             TEXT NOT NULL,        -- window label: 'push' | 'daily' | 'manual'
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  status              TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','complete','partial','failed')),
  -- F04-R11: one vehicle's failure must leave the others reported, so a run with
  -- any error and any success is 'partial' — never collapsed to 'failed'.
  vehicles_attempted  INTEGER NOT NULL DEFAULT 0,
  vehicles_succeeded  INTEGER NOT NULL DEFAULT 0,
  vehicles_failed     INTEGER NOT NULL DEFAULT 0,
  -- Per-vehicle reasons. An array of {vin, code} rather than a count, because
  -- "which vehicle and why" is the whole diagnostic value of the row.
  errors_json         TEXT NOT NULL DEFAULT '[]',
  datums_accepted     INTEGER NOT NULL DEFAULT 0,
  facts_written       INTEGER NOT NULL DEFAULT 0,
  snapshots_written   INTEGER NOT NULL DEFAULT 0,
  -- F04 AC6: collection cost is stated per run, not reconstructed at invoice time.
  cost_usd            REAL NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_ingest_run_started ON tesla_ingest_run (started_at DESC);
CREATE INDEX idx_ingest_run_status ON tesla_ingest_run (status, started_at DESC);

-- Rejected-datum ledger.
--
-- A datum can be refused for three reasons that must not be conflated: the field
-- is not in the 272-field catalog at all (a Tesla firmware addition we have not
-- seen), it is catalogued but outside the consented subset (working as intended),
-- or the vehicle reports the signal as invalid (a real availability gap that
-- F05-R11 must report rather than estimate around). Recording which is which is
-- how we tell "collection is broken" from "collection is correctly narrow".
CREATE TABLE tesla_ingest_rejection (
  rejection_id  TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES tesla_ingest_run (run_id) ON DELETE CASCADE,
  vin           TEXT,
  field_key     TEXT NOT NULL,
  reason        TEXT NOT NULL
                CHECK (reason IN ('unknown_field','not_collected','invalid_value','bad_vin')),
  value_kind    TEXT,
  observed_at   TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_ingest_rejection_run ON tesla_ingest_rejection (run_id, reason);
CREATE INDEX idx_ingest_rejection_field ON tesla_ingest_rejection (field_key, reason);

-- F02-R13 / F04-R16: the billing guard.
--
-- 0001 created tesla_billing_guard but nothing wrote to it. R-07 is a launch
-- blocker precisely because the destructive event (Tesla stripping every
-- telemetry config) has no member-visible symptom, so the guard must be
-- evaluated in-band on every ingest rather than by an operator watching a
-- dashboard. This view gives the current month-to-date position in one query.
CREATE VIEW tesla_billing_position AS
SELECT
  substr(period_start, 1, 7)              AS month,
  COALESCE(SUM(signals), 0)               AS signals,
  COALESCE(SUM(signals), 0) / 150000.0    AS cost_usd,
  COUNT(DISTINCT vin)                     AS vehicles
FROM tesla_signal_counter
GROUP BY substr(period_start, 1, 7);
