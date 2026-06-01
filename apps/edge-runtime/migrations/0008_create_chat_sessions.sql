-- Phase 10: Conversational Engine — chat session persistence
-- Bridges chat → form_submissions → scoring pipeline.
-- Dual-state model: state_json (evaluated) + collected_fields_json (raw).

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contact_id TEXT,
  submission_id TEXT,
  objective TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  collected_fields_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  last_tool TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_tenant ON chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_contact ON chat_sessions(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_submission ON chat_sessions(tenant_id, submission_id);
