-- Migration 0021 — Custom Fields Table
-- Adds support for user-defined custom fields on documents (for the UI).
-- Applied to both D1_PERSONAL and D1_AFIRMICO databases.

-- ═════════════════════════════════════════════════════════════════════════════
-- Table: custom_fields
-- Stores user-added custom fields per document
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS custom_fields (
  custom_field_id TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL,
  field_name      TEXT NOT NULL,
  field_value     TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_document
  ON custom_fields(document_id, field_name);
