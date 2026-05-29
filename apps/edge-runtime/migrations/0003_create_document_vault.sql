-- Track 4 Phase 5: Create document_vault table for R2 file metadata
-- Tracks uploaded documents per tenant and submission.

CREATE TABLE IF NOT EXISTS document_vault (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_vault_tenant
  ON document_vault(tenant_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_vault_submission
  ON document_vault(submission_id);
