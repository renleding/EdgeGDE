-- FEATURE-13: Data Export & Scheduled Reporting
-- Export schedules, runs, and audit trail

-- ============================================================
-- Export schedules: recurring or ad-hoc exports
-- ============================================================
CREATE TABLE telemetry_export_schedule (
  schedule_id       TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  scope             TEXT NOT NULL,                     -- 'all' | 'group' | 'vehicle'
  group_id          TEXT REFERENCES tesla_vehicle_group (group_id),
  vin               TEXT REFERENCES tesla_vehicle (vin),
  time_range        TEXT NOT NULL,                     -- 'hour' | 'week' | 'month' | 'year' | 'all'
  format            TEXT NOT NULL,                     -- 'csv' | 'xlsx' | 'pdf'
  recurrence        TEXT NOT NULL,                     -- 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'specific_date' | 'specific_weekdays'
  recurrence_config TEXT,                             -- JSON: specific date, weekdays, time, etc.
  recipients        TEXT NOT NULL,                    -- JSON array of email addresses
  email_template    TEXT,                             -- JSON: subject_template, body_template
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  next_run_at       TEXT,                             -- computed
  last_run_at       TEXT,
  last_run_status   TEXT                              -- 'delivered' | 'failed' | 'partial'
);

CREATE INDEX idx_telemetry_export_schedule_next_run ON telemetry_export_schedule (next_run_at) WHERE enabled = 1;

-- ============================================================
-- Export runs: history of every export execution
-- ============================================================
CREATE TABLE telemetry_export_run (
  run_id            TEXT PRIMARY KEY,
  schedule_id       TEXT REFERENCES telemetry_export_schedule (schedule_id),
  scope             TEXT NOT NULL,                    -- 'all' | 'group' | 'vehicle'
  group_id          TEXT,
  vin               TEXT,
  time_range        TEXT NOT NULL,
  format            TEXT NOT NULL,
  row_count         INTEGER,
  file_size         INTEGER,
  file_sha256       TEXT,
  delivery_status   TEXT NOT NULL                     -- 'delivered' | 'failed' | 'partial'
                      CHECK (delivery_status IN ('delivered','failed','partial','pending')),
  error_detail      TEXT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_telemetry_export_run_schedule ON telemetry_export_run (schedule_id, started_at);

-- ============================================================
-- Export audit: every run records full metadata (F13-R13)
-- ============================================================
CREATE TABLE telemetry_export_audit (
  audit_id          TEXT PRIMARY KEY,
  run_id            TEXT REFERENCES telemetry_export_run (run_id),
  action            TEXT NOT NULL,                    -- 'generated' | 'email_sent' | 'email_failed' | 'retry' | 'catchup'
  detail            TEXT,                             -- JSON
  occurred_at       TEXT NOT NULL
);

CREATE INDEX idx_telemetry_export_audit_run ON telemetry_export_audit (run_id, occurred_at);