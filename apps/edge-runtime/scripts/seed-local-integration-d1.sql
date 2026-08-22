-- EdgeGDE — local integration-test D1 seed (tests/domain-workspace.test.ts)
--
-- Self-contained + idempotent. Does NOT rely on the migrations chain:
-- fresh local D1 has no tables (wrangler.local.toml has no [[migrations]]),
-- and migrations 0001/0005 have bootstrap ALTERs that fail atomically when
-- re-run against a seeded DB. This seed mirrors the tables the workspace API
-- (src/api/workspace.ts) actually queries:
--   contacts (migration 0005) + applications/application_documents (0009)
--   + intelligence projection columns (0010).
--
-- Re-runs are safe: rows are cleared first, then seed data is inserted.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_email
  ON contacts(tenant_id, email)
  WHERE email != '';

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone
  ON contacts(tenant_id, phone)
  WHERE phone != '';

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  target_loan_amount INTEGER DEFAULT 0,
  collected_financials_json TEXT DEFAULT '{}',
  workflow_stage TEXT DEFAULT 'intake',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  affordability_score REAL,
  max_borrowing INTEGER,
  debt_ratio REAL,
  risk_score REAL,
  risk_level TEXT,
  readiness_status TEXT,
  missing_documents_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_contact ON applications(contact_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(workflow_stage);

CREATE TABLE IF NOT EXISTS application_documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  storage_pointer TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT DEFAULT 'uploaded_awaiting_review',
  uploaded_ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_docs_application ON application_documents(application_id, document_type);

-- ── Data reset (idempotent re-runs) ──────────────────────────────────────────
DELETE FROM application_documents;
DELETE FROM applications;
DELETE FROM contacts;

-- ── Seed data ────────────────────────────────────────────────────────────────
-- Test 2.1 (stage bucketing) requires at least one application in EACH of
-- intake/assessment/submission BEFORE the suite's own intake app is created,
-- so pre-seed one assessment + one submission application for the afirmico
-- tenant (the test's /workspace/init call provides the intake one).

INSERT INTO contacts (id, tenant_id, name, email, phone) VALUES
  ('seed-contact-assess', 'afirmico', 'Seed Assess', 'seed.assess@example.com', '0400000001');

INSERT INTO applications (id, contact_id, workflow_stage, created_ts, updated_ts,
                          target_loan_amount, risk_level, readiness_status) VALUES
  ('seed-app-assess', 'seed-contact-assess', 'assessment', 1750000000000, 1750000000000,
   450000, 'medium', 'ready');

INSERT INTO contacts (id, tenant_id, name, email, phone) VALUES
  ('seed-contact-submit', 'afirmico', 'Seed Submit', 'seed.submit@example.com', '0400000002');

INSERT INTO applications (id, contact_id, workflow_stage, created_ts, updated_ts,
                          target_loan_amount, risk_level, readiness_status) VALUES
  ('seed-app-submit', 'seed-contact-submit', 'submission', 1750000000001, 1750000000001,
   520000, 'low', 'ready');
