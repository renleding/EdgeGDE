-- Migration 0017: Historical Metric Series
-- Telemetry & Analytics v1.0.0:
-- Historical metric series are the authoritative input source for forecast
-- projections. Forecasts remain materialized projections, never truth.

CREATE TABLE IF NOT EXISTS metric_series (
  tenant_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily',
  timezone TEXT DEFAULT 'UTC',
  description TEXT,
  first_ds TEXT,
  last_ds TEXT,
  point_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, series_id)
);

CREATE INDEX IF NOT EXISTS idx_metric_series_tenant_metric
  ON metric_series(tenant_id, metric_name);

CREATE TABLE IF NOT EXISTS metric_points (
  tenant_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  ds TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  metadata_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, series_id, ds),
  FOREIGN KEY (tenant_id, series_id) REFERENCES metric_series(tenant_id, series_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metric_points_series_ds
  ON metric_points(tenant_id, series_id, ds DESC);

CREATE INDEX IF NOT EXISTS idx_metric_points_metric_ds
  ON metric_points(tenant_id, metric_name, ds DESC);
