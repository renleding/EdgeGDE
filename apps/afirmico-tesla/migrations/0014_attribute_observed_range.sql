-- FRS-010 F04: report an observed-at RANGE for vehicle attributes, not one instant.
--
-- WHY
-- ---
-- `tesla_vehicle_snapshot` is keyed `(vin, field_key)` and `persistDatums()` upserts it
-- with `observed_at = excluded.observed_at`. A payload therefore advances the timestamp
-- of ONLY the fields it carries. That is correct storage behaviour — but it means the
-- attributes of one vehicle can have been observed at several different times.
--
-- Observed live on 2026-10-07: a 5-field payload (Odometer, MilesSinceReset,
-- SelfDrivingMilesSinceReset, SentryMode, SpeedLimitWarning) moved those forward while
-- `CarType`, `Version` and `EfficiencyPackage` kept their earlier values from the
-- previous payload. Meanwhile the `tesla_vehicle_attribute` view exposed
-- `MAX(s.observed_at)` as a single `observed_at`, and the console rendered that as the
-- time the attributes were observed.
--
-- It was not. It was the time the MOST RECENTLY touched attribute was observed. A single
-- timestamp standing in for several is the same defect as the member-level key pill that
-- read `paired` from the first joined row, and it fails the same way: the summary
-- contradicts the detail, in the direction that looks healthy.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not add a stored `last_full_observation` column. That would be a third write
-- path over the snapshot table — the pattern behind both the `key_state` ratchet and the
-- never-written `verified_at`. A view is derived from the rows on every read and so
-- cannot drift from them; a stored summary can. The fix is to stop asserting a single
-- instant, not to compute and store a different one.
--
-- A CONSEQUENCE WORTH STATING
-- ---------------------------
-- `oldest_observed_at` and `newest_observed_at` EQUAL each other whenever an attribute
-- set was observed in one payload — the common case — and DIFFER when a partial payload
-- has touched some fields since. A reader can therefore tell "all observed together"
-- from "some are older than others" by comparing the bounds, which the single `MAX`
-- could not express at all.
--
-- The column is renamed away from `observed_at` rather than kept alongside it: leaving
-- the old name available would let a caller keep making the wrong claim by accident.
--
-- Idempotency: D1 applies each migration once (tracked in d1_migrations). `0013` is
-- ALREADY APPLIED in production (2026-10-07 00:49:47), so its view definition is left
-- untouched and this file re-states the view forward with DROP + CREATE.

DROP VIEW IF EXISTS tesla_vehicle_attribute;

CREATE VIEW tesla_vehicle_attribute AS
SELECT
  s.vin,
  MAX(CASE WHEN s.field_key = 'CarType'           THEN s.value_text END) AS car_type,
  MAX(CASE WHEN s.field_key = 'Version'           THEN s.value_text END) AS version,
  MAX(CASE WHEN s.field_key = 'EfficiencyPackage' THEN s.value_text END) AS efficiency_package,
  -- Trim is the variant badge Tesla reports ("Performance", "Long Range"), and the
  -- authoritative source for the variant once the next config apply asks for it. Until
  -- then this is NULL and the console falls back to the EfficiencyPackage codename,
  -- labelling the fallback rather than presenting it as a report.
  MAX(CASE WHEN s.field_key = 'Trim'              THEN s.value_text END) AS trim,
  -- The RANGE the attributes were observed over. Equal bounds mean one payload observed
  -- them all together; differing bounds mean a partial payload has touched some since,
  -- and no single instant describes the row.
  MIN(s.observed_at)                                                     AS oldest_observed_at,
  MAX(s.observed_at)                                                     AS newest_observed_at
FROM tesla_vehicle_snapshot s
GROUP BY s.vin;
