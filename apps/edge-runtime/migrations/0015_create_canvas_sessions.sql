-- Migration #0015: Create canvas_sessions table for CanvasSession_DO snapshots
-- Enables DO state persistence across evictions.

CREATE TABLE IF NOT EXISTS canvas_sessions (
  id TEXT PRIMARY KEY,
  doc_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  staging_pointer INTEGER NOT NULL DEFAULT -1,
  live_pointer INTEGER NOT NULL DEFAULT -1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
