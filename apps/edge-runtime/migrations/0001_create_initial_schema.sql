-- Bootstrap: initial schema for fresh D1 databases.
-- This migration creates all pre-migration tables that existed
-- before the migration system was formalized.
-- Applied manually on new D1 instances only.

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  form_id TEXT NOT NULL DEFAULT 'mortgage',
  payload TEXT NOT NULL DEFAULT '{}',
  lead_score INTEGER,
  deterministic_score INTEGER,
  score_band TEXT,
  score_rationale TEXT,
  contact_id TEXT,
  current_stage TEXT DEFAULT 'New Lead',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_tenant ON form_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(created_at);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free',
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS template_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  definition TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenant_artifacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  version TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenant_submissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  score REAL,
  classification TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scoring_rubrics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  ruleset_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_scores (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  total_score INTEGER NOT NULL DEFAULT 0,
  classification TEXT,
  trace_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  schedule TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_executions (
  id TEXT PRIMARY KEY,
  schedule_id TEXT,
  tenant_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  output TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broker_pipeline (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);
