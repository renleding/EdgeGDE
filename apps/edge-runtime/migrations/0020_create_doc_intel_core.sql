-- Migration 0020 — Document Intelligence Platform Core Schema
-- Creates all tables for the edge-document-intelligence engine.
-- Applied to both D1_PERSONAL and D1_AFIRMICO databases.

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: profiles
-- Stores identity profiles (personal vault persons or AFIRMICO clients)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
  profile_id        TEXT PRIMARY KEY,
  profile_type      TEXT NOT NULL,           -- 'personal' | 'client'
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  dob               TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  mobile            TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  encrypted_fields  TEXT NOT NULL DEFAULT '[]', -- JSON array of encrypted field names
  data_classification TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_profiles_name
  ON profiles(last_name, first_name);

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: documents
-- Tracks uploaded documents, their originals, processing results, and versions
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  document_id          TEXT PRIMARY KEY,
  profile_id           TEXT,
  document_type        TEXT NOT NULL,        -- 'passport', 'licence', 'medicare', 'payslip', 'bank_statement'
  filename_display     TEXT NOT NULL,        -- Human-readable name per FN-001 convention
  original_r2_key      TEXT NOT NULL,        -- Original uploaded file (kept forever per R2-005)
  working_r2_key       TEXT,                 -- Compressed version (if >10MB original)
  original_size_bytes  INTEGER NOT NULL DEFAULT 0,
  compressed_size_bytes INTEGER,
  ocr_status           TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | completed_with_warnings | failed
  confidence           REAL,
  document_version     INTEGER NOT NULL DEFAULT 1,
  document_group_id    TEXT,                 -- Links versions of the same document (e.g. passport v1/v2)
  active_version       INTEGER NOT NULL DEFAULT 1,
  data_classification  TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_profile
  ON documents(profile_id, document_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents(ocr_status);

CREATE INDEX IF NOT EXISTS idx_documents_type
  ON documents(document_type, created_at DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: extracted_fields
-- Stores individually AES-GCM encrypted extracted field values per document
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS extracted_fields (
  field_id              TEXT PRIMARY KEY,
  document_id           TEXT NOT NULL,
  field_name            TEXT NOT NULL,        -- e.g. 'passport_number', 'date_of_birth'
  field_value_encrypted TEXT NOT NULL,        -- AES-GCM ciphertext
  confidence            REAL NOT NULL DEFAULT 0,
  key_version           INTEGER NOT NULL DEFAULT 1,
  data_classification   TEXT NOT NULL DEFAULT 'CONFIDENTIAL',  -- PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  source_document       TEXT NOT NULL,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE INDEX IF NOT EXISTS idx_extracted_doc
  ON extracted_fields(document_id);

CREATE INDEX IF NOT EXISTS idx_extracted_field
  ON extracted_fields(field_name, confidence DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: processing_jobs
-- Job queue for M1 poller with heartbeat and retry lifecycle
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS processing_jobs (
  job_id              TEXT PRIMARY KEY,
  document_id         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
    -- pending | claimed | processing | retry_pending | completed | completed_with_warnings | failed
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  worker_id           TEXT,
  claimed_at          INTEGER,
  started_at          INTEGER,
  completed_at        INTEGER,
  heartbeat_at        INTEGER,
  last_error          TEXT,
  error_classification TEXT,                  -- TRANSIENT | PERMANENT | VALIDATION | SECURITY
  workflow_id         TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status
  ON processing_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_workflow
  ON processing_jobs(workflow_id);

CREATE INDEX IF NOT EXISTS idx_jobs_stale
  ON processing_jobs(status, heartbeat_at)
  WHERE status = 'processing';

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: key_registry
-- Wrapped key chain: per-tenant data encryption keys, versioned
-- Wrapped under MASTER_WRAP_KEY from Workers Secrets
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS key_registry (
  key_version   INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant        TEXT NOT NULL,
  wrapped_key   TEXT NOT NULL,               -- AES-GCM wrapped under MASTER_WRAP_KEY
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  retired_at    INTEGER,
  UNIQUE(tenant, key_version)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: activities
-- Per-profile operational event log
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS activities (
  activity_id     TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL,
  activity_type   TEXT NOT NULL,  -- 'upload', 'ocr', 'extraction', 'validation', 'encryption',
                                  -- 'form_population', 'doc_generation', 'crm_update', 'salestrekker_update'
  detail          TEXT NOT NULL DEFAULT '{}',
  workflow_id     TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_profile
  ON activities(profile_id, created_at DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: generated_documents
-- Tracks generated client summaries, forms, and exportable files
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS generated_documents (
  generated_document_id TEXT PRIMARY KEY,
  profile_id            TEXT NOT NULL,
  document_type         TEXT NOT NULL,        -- 'client_summary', 'form'
  generated_type        TEXT NOT NULL,        -- 'docx', 'pdf', 'html'
  r2_key                TEXT NOT NULL,
  template_version      TEXT,
  workflow_id           TEXT,
  data_classification   TEXT NOT NULL DEFAULT 'INTERNAL',
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_generated_profile
  ON generated_documents(profile_id, created_at DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: audit_log
-- Immutable policy-enforced audit trail with correlation IDs
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id      TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL,
  document_id   TEXT,
  client_id     TEXT,
  profile_id    TEXT,
  skill_id      TEXT,               -- 'hermes-personal-vault' | 'hermes-afirmico-onboarding'
  tenant_id     TEXT NOT NULL,       -- 'personal' | 'afirmico'
  stage         TEXT NOT NULL,       -- 'upload', 'ocr', 'extraction', 'validation', 'encryption',
                                     -- 'form_population', 'doc_generation', 'crm_update', 'salestrekker_update'
  status        TEXT NOT NULL,       -- 'started', 'completed', 'failed', 'pending_approval'
  actor         TEXT NOT NULL DEFAULT 'system',
  duration_ms   INTEGER,
  before_state  TEXT,
  after_state   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_workflow
  ON audit_log(workflow_id);

CREATE INDEX IF NOT EXISTS idx_audit_tenant
  ON audit_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_stage
  ON audit_log(tenant_id, stage, created_at DESC);
