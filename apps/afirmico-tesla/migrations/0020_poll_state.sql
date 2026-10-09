-- FRS-010 v2.3 FEATURE-14 (F14-R01..R10): dual-transport polling lane.
--
-- SDD-012 §4.2/§4.3. Two additions:
--
-- 1. telemetry_poll_state — one row per VIN that has ever been polled, holding
--    the identity-once flag (F14-R03) and the last successful poll instant
--    (F14-R04 cadence). The row IS the eligibility model: revocation deletes it,
--    so an absent row means "not poll-eligible" and no separate revoked flag can
--    drift out of sync (F14-R07). Created lazily by the first eligible ingest.
--
-- 2. tesla_telemetry_fact.source — every row records the transport that
--    delivered it (F14-R10). DEFAULT 'telemetry' keeps every existing row
--    honest: they all arrived by telemetry. A polled row writes 'poll', so an
--    export, a driver profile or an insurer query can attribute any value
--    without joining back to a transport log.

CREATE TABLE telemetry_poll_state (
  vin              TEXT PRIMARY KEY REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  identity_polled  INTEGER NOT NULL DEFAULT 0 CHECK (identity_polled IN (0,1)),
  last_poll_at     TEXT,
  last_identity_at TEXT,
  -- The last failed poll attempt (token refresh failure, empty response).
  -- Kept beside the cadence stamps so the next batch sees why a window passed
  -- without inventing a second table for diagnostics (SDD-012 §7).
  last_error       TEXT,
  updated_at       TEXT NOT NULL
);

ALTER TABLE tesla_telemetry_fact ADD COLUMN source TEXT
  NOT NULL DEFAULT 'telemetry'
  CHECK (source IN ('telemetry','poll'));