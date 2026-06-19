-- Migration 0016: Forecast Projections
-- Telemetry & Analytics v1.0.0: async forecast runs are stored as materialized
-- projections, never as authoritative truth.
--
-- Design invariants:
-- - tenant-scoped
-- - versioned model/config metadata
-- - point + quantile outputs
-- - KV stores latest pointer only; D1 stores queryable projection data
-- - forecast outputs must include model_name, model_version, config_hash,
--   input_snapshot_id, evaluation_metrics_json, and status

CREATE TABLE IF NOT EXISTS forecast_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  series_id TEXT NOT NULL DEFAULT 'tenant_global',
  model_name TEXT NOT NULL DEFAULT 'chronos-2',
  model_version TEXT,
  checkpoint TEXT,
  config_hash TEXT,
  input_snapshot_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  frequency TEXT NOT NULL DEFAULT 'daily',
  horizon INTEGER NOT NULL DEFAULT 30,
  quantiles_json TEXT NOT NULL DEFAULT '[0.1,0.5,0.9]',
  point_count INTEGER NOT NULL DEFAULT 0,
  evaluation_metrics_json TEXT DEFAULT '{}',
  external_job_id TEXT,
  requested_by TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_tenant_metric
  ON forecast_runs(tenant_id, metric_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_tenant_series
  ON forecast_runs(tenant_id, series_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_status
  ON forecast_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS forecast_points (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  ds TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  point_forecast REAL,
  p10 REAL,
  p50 REAL,
  p90 REAL,
  lower_bound REAL,
  upper_bound REAL,
  quantiles_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES forecast_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forecast_points_run
  ON forecast_points(run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_forecast_points_tenant_series_ds
  ON forecast_points(tenant_id, series_id, ds DESC);

CREATE TABLE IF NOT EXISTS forecast_series (
  tenant_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily',
  latest_run_id TEXT,
  latest_ds TEXT,
  latest_step INTEGER,
  latest_point REAL,
  latest_lower_bound REAL,
  latest_upper_bound REAL,
  latest_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, series_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_series_tenant_metric
  ON forecast_series(tenant_id, metric_name);
