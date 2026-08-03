-- FRS-007 Phase 3 — Control Plane: D1 Dispatcher Queue (Mission Queue)
--
-- Lease-based locking per FRS-007 Q2 resolution:
--   lease_duration_seconds  = 60  (item auto-releases if no heartbeat)
--   heartbeat_interval_seconds = 20
--   max_attempts            = 3   (dead-letter after repeated releases)
--
-- Status flow:
--   QUEUED ──claim──► IN_PROGRESS ──complete──► COMPLETED
--                          │
--                          ├──fail──► FAILED
--                          └──lease expires (no heartbeat)──► back to
--                             QUEUED (attempts+1); after max_attempts
--                             ──► DEAD

CREATE TABLE IF NOT EXISTS mission_queue (
    item_id                 TEXT PRIMARY KEY,
    mission_id              TEXT NOT NULL,
    payload_json            TEXT NOT NULL DEFAULT '{}',
    status                  TEXT NOT NULL DEFAULT 'QUEUED',
      -- QUEUED | IN_PROGRESS | COMPLETED | FAILED | DEAD
    priority                INTEGER NOT NULL DEFAULT 0,
    attempts                INTEGER NOT NULL DEFAULT 0,
    max_attempts            INTEGER NOT NULL DEFAULT 3,
    lease_holder            TEXT,                     -- performer node id
    lease_expires_at        INTEGER,                  -- unix epoch ms
    lease_duration_seconds  INTEGER NOT NULL DEFAULT 60,
    heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 20,
    heartbeat_count         INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at       INTEGER,
    result_json             TEXT,
    error_log               TEXT,
    created_at              INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at              INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    completed_at            INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mission_queue_claim
    ON mission_queue (status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_mission_queue_lease
    ON mission_queue (status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_mission_queue_mission
    ON mission_queue (mission_id);
