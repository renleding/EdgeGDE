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
