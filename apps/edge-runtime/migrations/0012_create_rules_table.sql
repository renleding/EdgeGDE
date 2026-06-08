CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  condition TEXT NOT NULL,
  output TEXT NOT NULL,
  priority INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_tenant ON rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(tenant_id, priority DESC);
