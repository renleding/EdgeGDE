-- Phase 18-20: Workspace Origination — applications + documents
-- Forward-only: new tables, no backfill from legacy form_submissions.

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  target_loan_amount INTEGER DEFAULT 0,
  collected_financials_json TEXT DEFAULT '{}',
  workflow_stage TEXT DEFAULT 'intake',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
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
