-- ============================================================
-- F12-N04: Batched / scheduled apply.
--
-- The apply sweep is asynchronous at target scale (1,000 vehicles
-- exceeds a single Worker request). The admin route records a
-- pending run, persists the per-VIN resolved config as JSON
-- (the queue processor re-loads it, so the two legs do not
-- depend on in-memory state), and enqueues one row per VIN.
-- The cron processor (the */5 * * * * trigger) drains the
-- queue in bounded batches: per-vehicle progress is
-- observable, and a mid-sweep failure never loses work.
-- ============================================================

CREATE TABLE config_apply_queue (
  queue_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL REFERENCES config_apply_run (run_id) ON DELETE CASCADE,
  vin          TEXT NOT NULL,
  position     INTEGER NOT NULL,       -- rollout order (canary first)
  config_json  TEXT NOT NULL,          -- resolved config for this VIN, as JSON
  status       TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','failed','halted')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  enqueued_at  TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);

CREATE INDEX idx_apply_queue_pending ON config_apply_queue (status, position) WHERE status IN ('pending','in_progress');
