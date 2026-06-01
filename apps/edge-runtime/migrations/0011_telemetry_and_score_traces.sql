-- Migration 0007: Telemetry + Score Trace D1 Tables
-- Moves high-frequency KV writes to structured D1 storage
-- KV becomes pointer-only; D1 holds all mutable/analytical data

-- ═══════════════════════════════════════════════════════════════════════════
-- telemetry_daily: Aggregated LLM call metrics per tenant per day
-- Replaces: TELEMETRY_KV tenant:{id}:telemetry:llm:{date} (per-call append)
-- Replaces: TELEMETRY_KV tenant:{id}:telemetry:llm:days:index
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS telemetry_daily (
  tenant_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  llm_calls INTEGER NOT NULL DEFAULT 0,
  llm_success INTEGER NOT NULL DEFAULT 0,
  llm_fail INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms REAL GENERATED ALWAYS AS (
    CASE WHEN llm_calls > 0 THEN CAST(total_latency_ms AS REAL) / llm_calls ELSE 0 END
  ) STORED,
  red_flag_count INTEGER NOT NULL DEFAULT 0,
  total_agentic_score INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_daily_date
  ON telemetry_daily (date DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_daily_tenant
  ON telemetry_daily (tenant_id, date DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- score_traces: Deterministic scoring audit trail
-- Replaces: TENANT_KV score_trace:{tenant}:{lead}:{rubric}
-- Enables: replay, compliance audit, per-rule breakdown queries
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS score_traces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  rubric_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL DEFAULT 100,
  classification TEXT NOT NULL,
  rubric_version INTEGER NOT NULL,
  matched_rules TEXT,          -- JSON array
  score_breakdown TEXT,        -- JSON object
  trace TEXT,                  -- JSON array of rule evaluations
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_score_traces_tenant_lead
  ON score_traces (tenant_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_score_traces_rubric
  ON score_traces (rubric_id);

CREATE INDEX IF NOT EXISTS idx_score_traces_created
  ON score_traces (created_at DESC);
