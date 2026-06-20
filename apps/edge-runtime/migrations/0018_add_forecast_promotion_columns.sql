-- Migration 0018: Forecast Promotion Gate Columns
-- Telemetry & Analytics v1.1:
-- Forecast runs record whether a projection passed validation and promotion
-- gates before it can be published as the latest forecast pointer.

ALTER TABLE forecast_runs ADD COLUMN promotion_status TEXT DEFAULT 'pending';
ALTER TABLE forecast_runs ADD COLUMN promotion_metrics_json TEXT DEFAULT '{}';
ALTER TABLE forecast_runs ADD COLUMN promotion_error TEXT;

CREATE INDEX IF NOT EXISTS idx_forecast_runs_promotion
  ON forecast_runs(promotion_status, completed_at DESC);
