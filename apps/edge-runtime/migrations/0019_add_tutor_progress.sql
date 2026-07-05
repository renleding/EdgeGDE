-- Migration 0019: Add tutor progress and test results tables
-- Tracks student learning progress across subjects

CREATE TABLE IF NOT EXISTS tutor_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL DEFAULT 'maths-standard',
  topic TEXT NOT NULL DEFAULT '',
  mastery INTEGER NOT NULL DEFAULT 0,
  time_on_task INTEGER NOT NULL DEFAULT 0,
  test_count INTEGER NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  mastery_chart TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_progress_subject ON tutor_progress(subject);

CREATE TABLE IF NOT EXISTS tutor_test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL DEFAULT 'maths-standard',
  questions TEXT NOT NULL DEFAULT '[]',
  answers TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  pct INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tutor_test_results_subject ON tutor_test_results(subject);
CREATE INDEX IF NOT EXISTS idx_tutor_test_results_completed ON tutor_test_results(completed_at);
