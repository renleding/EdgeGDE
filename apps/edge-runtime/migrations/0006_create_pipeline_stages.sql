-- Phase 9: Pipeline Stages — configurable deal workflow per tenant
-- Seeds 7 standard stages for each existing tenant.

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

-- Seed default stages for existing tenants
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_01', tenant_id, 'New Lead', 1 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_02', tenant_id, 'Fact Find', 2 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_03', tenant_id, 'Docs Requested', 3 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_04', tenant_id, 'Assessment', 4 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_05', tenant_id, 'Lender Submission', 5 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_06', tenant_id, 'Approved', 6 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
INSERT OR IGNORE INTO pipeline_stages (id, tenant_id, name, position)
  SELECT 'ST_07', tenant_id, 'Settled', 7 FROM (SELECT DISTINCT tenant_id FROM form_submissions);
