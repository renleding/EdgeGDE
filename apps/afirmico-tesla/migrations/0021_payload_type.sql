-- FRS-010 v2.5 FEATURE-15: Add payload_type to classify telemetry payload shapes
-- This allows distinguishing full snapshots from odometer heartbeats and trip counters,
-- which currently create separate "blank" rows in the telemetry_record view.

-- 1) Add payload_type column to tesla_telemetry_fact
-- Classifies the payload shape the datum came from
ALTER TABLE tesla_telemetry_fact
  ADD COLUMN payload_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (payload_type IN ('full', 'odometer_heartbeat', 'trip_counters', 'unknown'));

-- 2) Backfill existing rows based on which fields they contain
-- Full snapshot: has at least one enum/bool field (the 8 driver-assist settings)
UPDATE tesla_telemetry_fact
  SET payload_type = 'full'
  WHERE field_key IN (
    'SentryMode', 'SpeedLimitMode', 'SpeedLimitWarning', 'PinToDriveEnabled',
    'AutomaticBlindSpotCamera', 'AutomaticEmergencyBrakingOff',
    'BlindSpotCollisionWarningChime', 'EmergencyLaneDepartureAvoidance'
  );

-- Odometer heartbeat: only Odometer field present for this batch
UPDATE tesla_telemetry_fact
  SET payload_type = 'odometer_heartbeat'
  WHERE field_key = 'Odometer'
    AND batch_id IN (
      SELECT batch_id FROM tesla_telemetry_fact
      GROUP BY batch_id
      HAVING COUNT(*) = 1
         AND MAX(CASE WHEN field_key = 'Odometer' THEN 1 END) = 1
    )
    AND payload_type = 'unknown';

-- Trip counters: only MilesSinceReset and/or SelfDrivingMilesSinceReset present
UPDATE tesla_telemetry_fact
  SET payload_type = 'trip_counters'
  WHERE field_key IN ('MilesSinceReset', 'SelfDrivingMilesSinceReset')
    AND batch_id IN (
      SELECT batch_id FROM tesla_telemetry_fact
      GROUP BY batch_id
      HAVING COUNT(*) <= 2
         AND SUM(CASE WHEN field_key IN ('MilesSinceReset', 'SelfDrivingMilesSinceReset') THEN 1 ELSE 0 END) = COUNT(*)
         AND SUM(CASE WHEN field_key IN ('Odometer','SentryMode','SpeedLimitMode','SpeedLimitWarning',
                                        'PinToDriveEnabled','AutomaticBlindSpotCamera',
                                        'AutomaticEmergencyBrakingOff','BlindSpotCollisionWarningChime',
                                        'EmergencyLaneDepartureAvoidance') THEN 1 ELSE 0 END) = 0
    )
    AND payload_type = 'unknown';

-- 3) Create index for efficient payload_type queries
CREATE INDEX IF NOT EXISTS idx_tesla_telemetry_fact_payload_type
  ON tesla_telemetry_fact (vin, payload_type, observed_at);

-- 4) Enhance tesla_telemetry_record view to include payload_type info
-- Re-states the 0013 view (km columns + Trim) plus payload_type classification.
-- The view is forward-only: 0012/0013 are applied in production, so we re-define
-- the view here rather than editing those files.

DROP VIEW IF EXISTS tesla_telemetry_record;

CREATE VIEW tesla_telemetry_record AS
SELECT
  f.vin,
  f.observed_at,
  MAX(f.received_at)                                   AS received_at,
  MAX(f.batch_id)                                      AS batch_id,
  MAX(f.is_resend)                                     AS is_resend,
  -- Dominant payload_type for this instant (full > trip_counters > odometer_heartbeat)
  CASE MAX(CASE
        WHEN f.payload_type = 'full' THEN 3
        WHEN f.payload_type = 'trip_counters' THEN 2
        WHEN f.payload_type = 'odometer_heartbeat' THEN 1
        ELSE 0
      END)
    WHEN 3 THEN 'full'
    WHEN 2 THEN 'trip_counters'
    WHEN 1 THEN 'odometer_heartbeat'
    ELSE 'unknown'
  END                                                  AS payload_type,

  -- ---- odometer and distance counters (miles, as reported) ----------------
  MAX(CASE WHEN f.field_key = 'Odometer'
           THEN f.value_real END)                      AS odometer_mi,
  MAX(CASE WHEN f.field_key = 'MilesSinceReset'
           THEN f.value_real END)                      AS miles_since_reset_mi,
  MAX(CASE WHEN f.field_key = 'SelfDrivingMilesSinceReset'
           THEN f.value_real END)                      AS self_driving_miles_since_reset_mi,

  -- ---- the same three, converted (DERIVED, not observed) ------------------
  MAX(CASE WHEN f.field_key = 'Odometer'
           THEN f.value_real END) * 1.609344           AS odometer_km,
  MAX(CASE WHEN f.field_key = 'MilesSinceReset'
           THEN f.value_real END) * 1.609344           AS miles_since_reset_km,
  MAX(CASE WHEN f.field_key = 'SelfDrivingMilesSinceReset'
           THEN f.value_real END) * 1.609344           AS self_driving_miles_since_reset_km,

  -- ---- driver-assistance and security settings (boolean) -----------------
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
