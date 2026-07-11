-- Migration 0022 — Add R2 key columns to documents table
-- Required by the encryption layer and UI for field retrieval.
-- Applied to both D1_PERSONAL and D1_AFIRMICO databases.

ALTER TABLE documents ADD COLUMN r2_key TEXT;
ALTER TABLE documents ADD COLUMN fields_r2_key TEXT;
ALTER TABLE documents ADD COLUMN ocr_r2_key TEXT;