-- FRS-010 F04: a wide (column-per-field) read model over the telemetry fact stream.
--
-- WHY
-- ---
-- `tesla_telemetry_fact` is deliberately narrow and long: one row per
-- (vin, field_key, observed_at). That is the correct storage shape -- the field
-- universe is 272 and only 14 are collected, so a column-per-field table would
-- need a migration for every collection change and would be mostly NULL.
--
-- It is not, however, a shape you can analyse. Reading the history of a vehicle
-- means comparing several signals at the same instant, and in the long form that
-- is a self-join per field per instant. The request is to see the data "formatted
-- by column for each record", one row per instant with a column per field, in time
-- order -- which is exactly the pivot the analyst needs.
--
-- WHY A VIEW AND NOT A TABLE
-- -------------------------
-- A materialised wide table would be a second write path over the same facts, and
-- a second write path is a second thing that can disagree with the source. Every
-- false-success defect in this pipeline came from a record that was written
-- optimistically and never reconciled (see `tesla_vehicle_key.key_state`,
-- `tesla_telemetry_config.verified_at`). A view cannot drift: it is evaluated from
-- the facts on every read, so it is incapable of asserting anything the fact
-- stream does not already contain.
--
-- The cost is that a view cannot be indexed directly. At this scale that is
-- irrelevant -- 14 collected fields and a handful of vehicles -- and the underlying
-- table already carries `idx_tesla_telemetry_fact_batch (batch_id, observed_at)`
-- plus the (vin, field_key, observed_at) uniqueness. If read volume ever made this
-- slow, the correct fix is a materialised aggregate rebuilt inside the ingest run
-- (where the facts are written), not a view replaced by a hand-maintained table.
--
-- THE GRAIN
-- ---------
-- One row per (vin, observed_at). This is a true record and not an approximation:
-- `normalise()` stamps every datum in a payload with the same `observedAt`
-- (`datum.createdAt ?? receivedAt`), so a payload's signals share one instant and
-- one row per instant reconstructs exactly what the vehicle sent together. The
-- `MAX(...)` wrappers are consequently collapsing a single row per field, not
-- choosing between competing values -- they are the standard SQL pivot idiom, and
-- `classifyValue()` guarantees each datum populates exactly one typed column so
-- the COALESCE chains below cannot pick up a stray value from another kind.
--
-- WHAT IS NOT HERE, AND WHY
-- -------------------------
-- The three `once` tier fields (`CarType`, `Version`, `EfficiencyPackage`) are NOT
-- in the fact table -- `persistDatums()` routes `once` fields to
-- `tesla_vehicle_snapshot` because they are vehicle attributes, not a time series.
-- Pivoting facts therefore yields the eleven time-varying signals, which is the
-- honest set: adding the constants here would present a per-vehicle attribute as if
-- it were observed at every instant. They remain available from
-- `tesla_vehicle_snapshot` (current value) and `tesla_vehicle_snapshot_history`
-- (every value it has ever held, which is what makes a firmware change auditable).
--
-- NULL means "not reported in this payload", never zero. A signal the vehicle
-- explicitly could not measure arrives as `value_kind = 'invalid'` and also yields
-- NULL here -- correct, because treating an unmeasurable signal as 0 would
-- fabricate a reading. A reader must distinguish NULL (absent) from 0 (measured
-- zero); those are different facts and this view preserves the difference.

DROP VIEW IF EXISTS tesla_telemetry_record;

CREATE VIEW tesla_telemetry_record AS
SELECT
  f.vin,
  f.observed_at,
  -- When Tier 1 received it. Kept alongside observed_at so delivery lag is
  -- visible without a second query; a large gap is a transport symptom.
  MAX(f.received_at)                                   AS received_at,
  -- Provenance: the batch this instant arrived in, and whether it was a Tesla
  -- redelivery. `is_resend` marks a replay, which matters when a delta is
  -- computed across instants -- a resent duplicate must not be read as movement.
  MAX(f.batch_id)                                      AS batch_id,
  MAX(f.is_resend)                                     AS is_resend,

  -- ---- odometer and distance counters (real) -------------------------------
  -- These drive the derived profile, and `minimum_delta` on each means a repeat
  -- of the same value is the expected quiet period rather than a fault.
  MAX(CASE WHEN f.field_key = 'Odometer'
           THEN f.value_real END)                      AS odometer,
  MAX(CASE WHEN f.field_key = 'MilesSinceReset'
           THEN f.value_real END)                      AS miles_since_reset,
  MAX(CASE WHEN f.field_key = 'SelfDrivingMilesSinceReset'
           THEN f.value_real END)                      AS self_driving_miles_since_reset,

  -- ---- driver-assistance and security settings (boolean) -------------------
  -- Stored as 0/1 by classifyValue; surfaced as integers because D1 has no
  -- boolean type and a 0/1 integer is unambiguous in both SQL and the UI.
  MAX(CASE WHEN f.field_key = 'AutomaticBlindSpotCamera'
           THEN f.value_bool END)                      AS automatic_blind_spot_camera,
  MAX(CASE WHEN f.field_key = 'AutomaticEmergencyBrakingOff'
           THEN f.value_bool END)                      AS automatic_emergency_braking_off,
  MAX(CASE WHEN f.field_key = 'BlindSpotCollisionWarningChime'
           THEN f.value_bool END)                      AS blind_spot_collision_warning_chime,
  MAX(CASE WHEN f.field_key = 'EmergencyLaneDepartureAvoidance'
           THEN f.value_bool END)                      AS emergency_lane_departure_avoidance,
  MAX(CASE WHEN f.field_key = 'PinToDriveEnabled'
           THEN f.value_bool END)                      AS pin_to_drive_enabled,
  MAX(CASE WHEN f.field_key = 'SpeedLimitMode'
           THEN f.value_bool END)                      AS speed_limit_mode,

  -- ---- enum-valued settings ------------------------------------------------
  -- Tesla may deliver an enum as text or as an integer depending on the field, so
  -- these are rendered to one text column. COALESCE order prefers the text form
  -- (already human-readable) and falls back to the integer ordinal rather than
  -- discarding a value whose representation is numeric.
  COALESCE(
    MAX(CASE WHEN f.field_key = 'SentryMode' THEN f.value_text END),
    CAST(MAX(CASE WHEN f.field_key = 'SentryMode' THEN f.value_int END) AS TEXT),
    CAST(MAX(CASE WHEN f.field_key = 'SentryMode' THEN f.value_bool END) AS TEXT)
  )                                                    AS sentry_mode,
  COALESCE(
    MAX(CASE WHEN f.field_key = 'SpeedLimitWarning' THEN f.value_text END),
    CAST(MAX(CASE WHEN f.field_key = 'SpeedLimitWarning' THEN f.value_int END) AS TEXT),
    CAST(MAX(CASE WHEN f.field_key = 'SpeedLimitWarning' THEN f.value_bool END) AS TEXT)
  )                                                    AS speed_limit_warning

FROM tesla_telemetry_fact f
GROUP BY f.vin, f.observed_at;

-- The view groups by (vin, observed_at); this supports the ordered history read
-- the admin telemetry browser performs.
CREATE INDEX IF NOT EXISTS idx_tesla_telemetry_fact_vin_observed
  ON tesla_telemetry_fact (vin, observed_at);

-- Vehicle-level attributes (the `once` tier), kept as their own view so a reader
-- never confuses a constant with a time series. `tesla_vehicle_snapshot` is the
-- current value; the history table is the audit trail of every value held.
DROP VIEW IF EXISTS tesla_vehicle_attribute;

CREATE VIEW tesla_vehicle_attribute AS
SELECT
  s.vin,
  MAX(CASE WHEN s.field_key = 'CarType'           THEN s.value_text END) AS car_type,
  MAX(CASE WHEN s.field_key = 'Version'           THEN s.value_text END) AS version,
  MAX(CASE WHEN s.field_key = 'EfficiencyPackage' THEN s.value_text END) AS efficiency_package,
  MAX(s.observed_at)                                                     AS observed_at
FROM tesla_vehicle_snapshot s
GROUP BY s.vin;
