-- Phase 21: MCP Swarm Intelligence Projections
-- Adds intelligence scoring columns to the applications table.
-- Forward-only: nullable columns, no backfill, no data rewrite.

ALTER TABLE applications ADD COLUMN affordability_score REAL;
ALTER TABLE applications ADD COLUMN max_borrowing INTEGER;
ALTER TABLE applications ADD COLUMN debt_ratio REAL;
ALTER TABLE applications ADD COLUMN risk_score REAL;
ALTER TABLE applications ADD COLUMN risk_level TEXT;
ALTER TABLE applications ADD COLUMN readiness_status TEXT;
ALTER TABLE applications ADD COLUMN missing_documents_json TEXT;
