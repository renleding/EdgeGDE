-- Migration 0022: persist export artifacts to R2 for download
--
-- The export worker generated the CSV in memory and handed it to the
-- email sender. Nothing was persisted, so once the (failing) email
-- send completed there was no artifact left to retrieve. This adds
-- an r2_key column on telemetry_export_run so every generated export
-- is stored under exports/<run_id>.<ext> in the RAW_PAYLOADS bucket
-- and downloadable from the admin console.

ALTER TABLE telemetry_export_run ADD COLUMN r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_export_run_r2_key
  ON telemetry_export_run (r2_key);
