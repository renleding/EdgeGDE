-- Track 4 Phase 5: Add deterministic_score to form_submissions
-- Stores the pure FNS40821 score (0-70) separate from the combined total.
-- Enables direct SQL aggregation without fragile regex parsing.

ALTER TABLE form_submissions
  ADD COLUMN deterministic_score INTEGER DEFAULT 0;
