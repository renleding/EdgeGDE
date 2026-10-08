-- FEATURE-12: Seed the global scope as total (F12-R02).
-- Runs after 0002_seed_tesla_catalog.sql so the catalog exists.
-- The global tier is seeded from the catalog at interval_seconds = 180 for
-- every collected field. SYNC_INTERVAL_SECONDS remains the seed value.

-- Insert the global scope row
INSERT INTO telemetry_config_scope (scope_id, scope_kind, group_id, vin, created_at, updated_at, created_by)
VALUES ('global', 'global', NULL, NULL, datetime('now'), datetime('now'), 'system');

-- Seed one entry per collected field from the catalog
-- interval_seconds = 180, minimum_delta from catalog where applicable, enabled = 1
INSERT INTO telemetry_config_entry (scope_id, field_key, interval_seconds, minimum_delta, enabled, updated_at)
SELECT
  'global',
  field_key,
  180,
  CASE
    WHEN collection_tier <> 'once' AND min_delta IS NOT NULL AND min_delta > 0 THEN min_delta
    ELSE NULL
  END,
  1,
  datetime('now')
FROM tesla_field_catalog
WHERE collected = 1
ORDER BY field_key;