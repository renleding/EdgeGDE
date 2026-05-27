CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_form
ON form_submissions (tenant_id, form_id);

CREATE INDEX IF NOT EXISTS idx_created_at
ON form_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_created
ON form_submissions (tenant_id, created_at DESC);

-- Phase 34 v7.0: Atomic versioning source of truth
CREATE TABLE IF NOT EXISTS tenant_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, artifact_id)
);

-- Phase 35D: Tenant layout submission queue
CREATE TABLE IF NOT EXISTS tenant_submissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  design_md TEXT NOT NULL,
  source TEXT DEFAULT 'ai',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'failed')),
  submitted_by TEXT NOT NULL,
  approved_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_submissions_status
ON tenant_submissions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_tenant
ON tenant_submissions (tenant_id, status);

-- Track 4 Phase 3: Template gallery
CREATE TABLE IF NOT EXISTS template_registry (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  version INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,
  checksum TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'system' CHECK(origin IN ('system', 'tenant', 'ai')),
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_templates_active
ON template_registry (is_active, category);

CREATE INDEX IF NOT EXISTS idx_templates_tenant
ON template_registry (tenant_id);

-- Track 4 Phase 4: Dynamic form builder (draft state machine)
CREATE TABLE IF NOT EXISTS form_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_template_id TEXT,
  status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting', 'pending_approval', 'published', 'rejected')),
  version INTEGER NOT NULL DEFAULT 1,
  checksum TEXT,
  last_valid BOOLEAN NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drafts_tenant ON form_drafts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON form_drafts (status);
CREATE INDEX IF NOT EXISTS idx_drafts_tenant_status ON form_drafts (tenant_id, status);

-- Track 4 Final: Tenant registry (D1 mirror for safe listing)
CREATE TABLE IF NOT EXISTS tenants (
  slug TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track 4 Phase 5: Lead scoring
CREATE TABLE IF NOT EXISTS scoring_rubrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  ruleset_json TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rubrics_tenant ON scoring_rubrics (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rubrics_active ON scoring_rubrics (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS lead_scores (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  rubric_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
  override_score INTEGER,
  override_rationale TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, lead_id, rubric_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_tenant_lead ON lead_scores (tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_scores_value ON lead_scores (tenant_id, score DESC);

-- Track 4 Phase 6: Scheduled reports
CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  utc_offset INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT 1,
  next_run_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON report_schedules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON report_schedules (next_run_at, is_active);

CREATE TABLE IF NOT EXISTS report_executions (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  target_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','success','failed')),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sent','failed_transient','failed_permanent')),
  artifact_key TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  UNIQUE(schedule_id, tenant_id, report_type, target_date)
);

CREATE INDEX IF NOT EXISTS idx_executions_schedule ON report_executions (schedule_id, status);
CREATE INDEX IF NOT EXISTS idx_executions_stale ON report_executions (status, updated_at);
