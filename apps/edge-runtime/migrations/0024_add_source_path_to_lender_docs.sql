-- 0024_add_source_path_to_lender_docs.sql
-- Adds source_path column for incremental dedup tracking.
-- Also prepares for expanded doc_type values (CHECK constraint unchanged for now).

ALTER TABLE lender_docs ADD COLUMN source_path TEXT NOT NULL DEFAULT '';

-- Index for fast incremental dedup lookup
CREATE INDEX IF NOT EXISTS idx_lender_docs_source_path
  ON lender_docs(source_path);
