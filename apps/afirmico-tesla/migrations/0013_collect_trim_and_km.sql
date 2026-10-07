-- FRS-010 F03/F04: collect Trim, and give every miles field a kilometre column.
--
-- TWO CHANGES, ONE MIGRATION, BECAUSE BOTH ARE FORWARD-ONLY RE-STATEMENTS OF THE
-- SAME TWO VIEWS/COLUMNS AND SPLITTING THEM WOULD DOUBLE THE VIEW REDEFINITIONS.
--
-- ---------------------------------------------------------------------------
-- 1. TRIM: report the variant instead of inferring it
-- ---------------------------------------------------------------------------
-- The owner asked the console to state "Model 3 Performance 2025". No single
-- collected field carries that:
--
--   model   <- CarType           (collected; "CarTypeModel3")
--   variant <- Trim              (THIS MIGRATION; "Performance", "Long Range")
--   year    <- VIN position 10   (derived; Tesla exposes no model-year field)
--
-- `Trim` was catalogued from the start (`vehicle_config.trim_badging`, part of the
-- 272-field universe) but left `collected = 0` / `collection_tier = 'never'`, so the
-- catalog knew the field existed and nothing ever asked the vehicle for it. This
-- enables it so the variant is REPORTED rather than inferred from the
-- EfficiencyPackage codename (POPPYSEED), which remains as a fallback for vehicles
-- that streamed before this migration.
--
-- WHY `once`: Trim is a vehicle attribute — it does not change while the vehicle
-- exists at that hardware configuration. `trg_tesla_snapshot_requires_once_field`
-- requires exactly this tier for anything written to `tesla_vehicle_snapshot`, and
-- `persistDatums()` routes `once` fields to the snapshot table (current value +
-- history) rather than the fact stream. The tier is what makes the write legal, not
-- a preference.
--
-- CONSENT: no re-consent required, and this was verified rather than assumed. The
-- authorisation (F01-R02a, owner decision 2026-10-03) is deliberately broad — it
-- covers the information made available through the member's authorised Tesla
-- connection and does not enumerate a closed field list, precisely so that changing
-- what is collected is not a change to the consent already given. `CONSENTED_FIELDS`
-- in src/consent-policy.ts is the collection set, not the consent scope, and it now
-- lists Trim so F01 AC6 (catalog set == declared set) stays true.
--
-- ---------------------------------------------------------------------------
-- 2. KILOMETRES: a derived column beside every miles column
-- ---------------------------------------------------------------------------
-- Tesla reports distance in MILES. The members, the insurers and the published
-- segments are metric, and the export already converts (src/derive.ts
-- MILES_TO_KM = 1.609344). The conversion existed only in the derived profile, so
-- the raw record view — the thing an analyst reads — was still miles-only.
--
-- These columns are DERIVED, not observed, and are named and commented as such. That
-- distinction matters: a km column must never be mistaken for a second measurement,
-- and if the conversion factor is ever revised these are recomputed by the view
-- rather than silently retaining an old conversion. `miles * 1.609344` is exactly
-- the constant derive.ts uses, so the record view and the derived profile cannot
-- disagree on the same reading.
--
-- NULL propagates: an absent miles signal yields NULL km, never 0. The rounding is
-- deliberately NOT done here — full precision is preserved and presentation decides
-- how many decimals to show, because tidying a stored value destroys information the
-- analyst may need.
--
-- ---------------------------------------------------------------------------
-- WHY `CREATE OR REPLACE` AND A HIGHER MIGRATION NUMBER
-- ---------------------------------------------------------------------------
-- 0012 is ALREADY APPLIED in production. Editing it in place would leave the file on
-- disk different from the view actually deployed — a divergence that is invisible
-- until someone reads the file instead of the database. The rule is to never edit an
-- applied migration; this file redefines the view forward instead. Re-applying 0012
-- by hand would now also be harmless, since it drops and recreates the view.
--
-- UNTIL THE NEXT CONFIG APPLY: Trim is `collected = 1` but the vehicle has not yet
-- been asked for it, so no Trim value appears yet. Expected, not a fault. The
-- console's variant falls back to the EfficiencyPackage codename and labels that
-- fallback, so a fallback is never mistaken for a report.

-- ---- Part 1: enable Trim --------------------------------------------------

UPDATE tesla_field_catalog
   SET collected = 1,
       collection_tier = 'once',
       collection_group = '$vehicleInfo'
 WHERE field_key = 'Trim';

-- ---- Part 2: km columns on the wide record view ---------------------------

DROP VIEW IF EXISTS tesla_telemetry_record;

CREATE VIEW tesla_telemetry_record AS
SELECT
  f.vin,
  f.observed_at,
  MAX(f.received_at)                                   AS received_at,
  MAX(f.batch_id)                                      AS batch_id,
  MAX(f.is_resend)                                     AS is_resend,

  -- ---- odometer and distance counters (miles, as reported) ----------------
  MAX(CASE WHEN f.field_key = 'Odometer'
           THEN f.value_real END)                      AS odometer_mi,
  MAX(CASE WHEN f.field_key = 'MilesSinceReset'
           THEN f.value_real END)                      AS miles_since_reset_mi,
  MAX(CASE WHEN f.field_key = 'SelfDrivingMilesSinceReset'
           THEN f.value_real END)                      AS self_driving_miles_since_reset_mi,

  -- ---- the same three, converted (DERIVED, not observed) ------------------
  -- Multiplied by the identical constant src/derive.ts uses (1.609344) so the raw
  -- record and the derived profile can never disagree on the same reading. NULL in,
  -- NULL out — an absent signal must not become 0 km.
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

  -- ---- enum-valued settings ----------------------------------------------
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

-- ---- Part 3: the vehicle-attribute view, now including Trim ---------------

DROP VIEW IF EXISTS tesla_vehicle_attribute;

CREATE VIEW tesla_vehicle_attribute AS
SELECT
  s.vin,
  MAX(CASE WHEN s.field_key = 'CarType'           THEN s.value_text END) AS car_type,
  MAX(CASE WHEN s.field_key = 'Version'           THEN s.value_text END) AS version,
  MAX(CASE WHEN s.field_key = 'EfficiencyPackage' THEN s.value_text END) AS efficiency_package,
  -- Trim is the variant badge Tesla reports ("Performance", "Long Range"), and is the
  -- authoritative source for the variant once the next config apply asks for it. Until
  -- then this is NULL and the console falls back to the EfficiencyPackage codename,
  -- labelling the fallback rather than presenting it as a report.
  MAX(CASE WHEN s.field_key = 'Trim'              THEN s.value_text END) AS trim,
  MAX(s.observed_at)                                                     AS observed_at
FROM tesla_vehicle_snapshot s
GROUP BY s.vin;
