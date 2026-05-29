-- Track 4 Phase 5: Add lead scoring columns to form_submissions
-- Applied before queue consumer goes live

ALTER TABLE form_submissions
  ADD COLUMN lead_score INTEGER DEFAULT 0;

ALTER TABLE form_submissions
  ADD COLUMN score_band TEXT DEFAULT 'cold'
  CHECK(score_band IN ('hot', 'warm', 'cold'));

ALTER TABLE form_submissions
  ADD COLUMN score_rationale TEXT DEFAULT '';

-- Index for kanban-style pipeline filtering
CREATE INDEX IF NOT EXISTS idx_form_submissions_score_band
  ON form_submissions(tenant_id, score_band, created_at DESC);

-- Index for hot-lead alert queries
CREATE INDEX IF NOT EXISTS idx_form_submissions_hot
  ON form_submissions(tenant_id, lead_score DESC)
  WHERE lead_score >= 80;
