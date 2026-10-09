-- F12-R16 (FRS-010 v2.3): tiered global seed.
--
-- 0017 seeded every collected field at 180s uniformly. The owner's answer on
-- 2026-10-09 was that low-volatility fields do not need a 180s cadence — 6h
-- (21600s) is their setting — and that Odometer polls weekly (F14-R04), which
-- makes 604800s its interval: that value IS the weekly cadence, not a streaming
-- ceiling.
--
--   fast  180s    the two streaming distance counters (no REST equivalent —
--                 telemetry-only, F14-R01 — so their interval is a streaming
--                 cadence and nothing else can carry them)
--   poll  604800s Odometer — weekly backstop per F14-R04; overridable per scope
--   slow  21600s  every other collected field: static identity, driver-assist
--                 settings, on_change states (the owner's PinToDriveEnabled example)
--
-- GLOBAL ROWS ONLY, AND ONLY UNTOUCHED ONES. The guard matches rows whose
-- updated_at is exactly the timestamp 0017 wrote — any row an operator edited
-- since then carries a different updated_at and is skipped. An operator's
-- deliberate 180s override of a slow field survives the migration; a field the
-- seed itself placed does not.

-- fast tier: telemetry-only streaming counters stay at 180s
UPDATE telemetry_config_entry
   SET interval_seconds = 180,
       updated_at = datetime('now')
 WHERE scope_id = 'global'
   AND field_key IN ('MilesSinceReset', 'SelfDrivingMilesSinceReset')
   AND updated_at NOT LIKE '%T%';          -- 0017 used datetime('now'): 'YYYY-MM-DD HH:MM:SS'

-- poll tier: Odometer = the weekly cadence (F14-R04)
UPDATE telemetry_config_entry
   SET interval_seconds = 604800,
       updated_at = datetime('now')
 WHERE scope_id = 'global'
   AND field_key = 'Odometer'
   AND updated_at NOT LIKE '%T%';

-- slow tier: every remaining collected field gets 6h
UPDATE telemetry_config_entry
   SET interval_seconds = 21600,
       updated_at = datetime('now')
 WHERE scope_id = 'global'
   AND field_key NOT IN ('MilesSinceReset', 'SelfDrivingMilesSinceReset', 'Odometer')
   AND updated_at NOT LIKE '%T%';
