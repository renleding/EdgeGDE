-- ============================================================
-- FEATURE-16 (F16-R05, F16-N03): dead-letter table for the
-- distributed apply queue. A VIN that fails permanently (4xx,
-- invalid VIN, revoked token) or exhausts its retries lands
-- here with the original message preserved for diagnosis and
-- replay. Bounded at 10k rows (F16-N03); a non-empty table
-- raises an operator alert.
-- ============================================================

CREATE TABLE config_apply_dead_letter (
  dl_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  vin          TEXT NOT NULL,
  attempts     INTEGER NOT NULL,
  error_detail TEXT NOT NULL,
  message_json TEXT NOT NULL,
  dead_at      TEXT NOT NULL
);

CREATE INDEX idx_apply_dl_run ON config_apply_dead_letter (run_id);
