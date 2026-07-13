-- 0022_create_knowledge_base.sql
-- Knowledge base for Purple CFS LMS transcripts, lender docs,
-- and hybrid FTS5 search. Created 2026-07-13 as part of the
-- LMS extraction project (IPS-lms-knowledge-base-v1).

-- ── SOURCE VIDEOS ──────────────────────────────────────────────────────────
-- Video metadata only. Actual video stored on M1 + optionally in R2.
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  vimeo_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  transcript_id TEXT,
  extracted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_extracted
  ON videos(extracted_at DESC);

-- ── TRANSCRIPTS ────────────────────────────────────────────────────────────
-- The core knowledge payload: full clean VTT-to-markdown transcript.
CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  title TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  markdown_content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  extracted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_video
  ON transcripts(video_id);

-- FTS5 virtual table for full-text keyword search over transcripts.
-- Matches for exact phrases, acronyms (LVR, BAS), and procedure text.
CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
  title,
  markdown_content,
  content='transcripts',
  content_rowid='rowid'
);

-- Triggers to keep FTS5 index in sync with transcripts table.
CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
  INSERT INTO transcripts_fts(rowid, title, markdown_content)
  VALUES (new.rowid, new.title, new.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, title, markdown_content)
  VALUES ('delete', old.rowid, old.title, old.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS transcripts_au AFTER UPDATE ON transcripts BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, title, markdown_content)
  VALUES ('delete', old.rowid, old.title, old.markdown_content);
  INSERT INTO transcripts_fts(rowid, title, markdown_content)
  VALUES (new.rowid, new.title, new.markdown_content);
END;

-- ── LENDER DOCUMENTS ──────────────────────────────────────────────────────
-- Future: lender policies, application forms, guides ingested the same way.
CREATE TABLE IF NOT EXISTS lender_docs (
  id TEXT PRIMARY KEY,
  lender_name TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('policy','form','guide','faq','other')),
  title TEXT NOT NULL,
  markdown_content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_lender_docs_lender
  ON lender_docs(lender_name);

CREATE INDEX IF NOT EXISTS idx_lender_docs_type
  ON lender_docs(doc_type);

-- FTS5 index for lender docs (separate from transcripts for type-scoped queries)
CREATE VIRTUAL TABLE IF NOT EXISTS lender_docs_fts USING fts5(
  title,
  markdown_content,
  content='lender_docs',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS lender_docs_ai AFTER INSERT ON lender_docs BEGIN
  INSERT INTO lender_docs_fts(rowid, title, markdown_content)
  VALUES (new.rowid, new.title, new.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS lender_docs_ad AFTER DELETE ON lender_docs BEGIN
  INSERT INTO lender_docs_fts(lender_docs_fts, rowid, title, markdown_content)
  VALUES ('delete', old.rowid, old.title, old.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS lender_docs_au AFTER UPDATE ON lender_docs BEGIN
  INSERT INTO lender_docs_fts(lender_docs_fts, rowid, title, markdown_content)
  VALUES ('delete', old.rowid, old.title, old.markdown_content);
  INSERT INTO lender_docs_fts(rowid, title, markdown_content)
  VALUES (new.rowid, new.title, new.markdown_content);
END;
