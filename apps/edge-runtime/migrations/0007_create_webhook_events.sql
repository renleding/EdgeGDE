-- Audit Sprint 1: Webhook events persistence table

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT 'hot_lead',
  tenant_id TEXT NOT NULL,
  submission_id TEXT,
  payload JSON NOT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant
  ON webhook_events(tenant_id, received_at DESC);
