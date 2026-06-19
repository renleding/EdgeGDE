---
name: EdgeGDE_Telemetry_Analytics_v1_0_0_Functional
version: "1.0.0"
status: locked_functional_spec
owner: Hermes
created_at: "2026-06-19"
---

# EdgeGDE Telemetry & Analytics v1.0.0 — Functional Specification

## 0. Locked Decision

Telemetry & Analytics v1.0.0 is locked as a multi-layer observability and analytics strategy.

TimesFM 2.5 is explicitly NOT locked as the forecasting solution.

Forecasting remains a separate research track.

## 1. Purpose

Telemetry & Analytics v1.0.0 defines the first approved observability and analytics layer for EdgeGDE.

It provides:

- unified infrastructure observability
- LLM/agent workflow tracing
- edge/web/security analytics
- EdgeGDE-native business and audit telemetry
- a clean separation between telemetry, analytics, and authoritative state
- a foundation for later forecasting work

## 2. Scope

### In scope for v1.0.0

- SigNoz as primary infrastructure observability backend
- Langfuse as production LLM/agent tracing backend
- Arize Phoenix as LLM eval/debug tooling
- Cloudflare as edge/web/security analytics source
- EdgeGDE AuditLedger/D1 as business/audit truth and projection source
- tenant-scoped telemetry contracts
- redaction and cardinality guardrails
- dashboard/alerting ownership boundaries
- forecasting research kickoff, not forecasting implementation

### Out of scope for v1.0.0

- selecting a final forecasting model
- implementing TimesFM 2.5
- implementing any forecasting pipeline
- storing forecasts as authoritative truth
- replacing EdgeGDE deterministic state with telemetry
- sending sensitive KYC/PII/document content to third-party telemetry systems
- using SigNoz, Langfuse, Phoenix, or Cloudflare as the source of truth for tenant state

## 3. Core Invariants

- `telemetry_observes_state_but_never_owns_state`: telemetry systems observe EdgeGDE. They do not own tenant state, audit truth, or deterministic business state.
- `edgegde_audit_ledger_is_authoritative_for_business_events`: AuditLedger_DO remains the append-only event source for business/audit events.
- `d1_is_query_projection_for_business_analytics`: D1 is the queryable projection layer for finalized business data.
- `kv_remains_pointer_only`: KV stores pointers, config, and small indexes only. No telemetry payloads, large JSON blobs, or analytics payloads.
- `no_kv_list_in_runtime_paths`: KV listing remains forbidden in runtime paths.
- `tenant_isolation_is_mandatory`: all telemetry, analytics, and dashboards must preserve tenant boundaries.
- `no_secrets_in_telemetry`: secrets, tokens, API keys, passwords, HMAC keys, and raw credentials must never be logged or traced.
- `no_full_llm_payloads_by_default`: full prompts and full model responses must not be sent to SigNoz by default.
- `forecast_outputs_are_projections_not_truth`: any future forecast output must be stored as a versioned projection with lineage, model/config metadata, and uncertainty.
- `timesfm_is_not_selected`: TimesFM 2.5 is not the selected forecasting solution in v1.0.0.

## 4. Source Systems

### 4.1 Primary Infrastructure & Core Telemetry

Owner: SigNoz

Purpose:

- unified logs
- system metrics
- distributed traces
- Worker health
- Queue health
- D1/KV/R2/DO operational signals
- deployment and runtime health
- external provider latency/error signals

SigNoz answers:

- Is the system healthy?
- Where did a request fail or slow down?
- Are queues backing up?
- Are D1/KV/R2/DO operations failing?
- Are deployments healthy?
- Are external dependencies degraded?

### 4.2 AI Agent Swarm Tracing

Production trace owner: Langfuse

Eval/debug owner: Arize Phoenix

Purpose:

- LLM calls
- agent runs
- tool calls
- prompt/config versions
- token/cost tracking
- evals
- model behavior debugging
- prompt/model regression analysis

Langfuse answers:

- What did agents and LLMs do?
- Which model/provider was called?
- What tools were invoked?
- What did a specific agent run cost?
- Which prompt/model version produced a result?

Phoenix answers:

- Why did the model behave that way?
- Which evals failed?
- Which prompt/model changes caused regressions?
- How do datasets, traces, and eval results compare?

### 4.3 Web & Edge Analytics

Owner: Cloudflare

Purpose:

- web traffic patterns
- threat detection
- bot activity
- WAF events
- CDN/cache behavior
- edge request patterns
- geographic traffic
- attack surface visibility

Cloudflare answers:

- What happened at the edge?
- Is traffic normal?
- Are bots or attacks increasing?
- Which routes are receiving traffic?
- Are WAF/cache/CDN controls working?

### 4.4 EdgeGDE Business & Audit Telemetry

Owner: EdgeGDE AuditLedger_DO + D1 projections

Purpose:

- authoritative business event history
- tenant-scoped audit trail
- deterministic state-change history
- queryable analytics projections
- forecast/projection lineage when forecasting is added later

EdgeGDE answers:

- What business/tenant state changed?
- Who or what changed it?
- Was the change valid?
- Which projection was generated from which source snapshot?
- Which model/config produced a future forecast projection?

## 5. Functional Requirements

### FR-001 — Infrastructure telemetry

The system must emit infrastructure telemetry sufficient to answer RED/USE questions for:

- Workers
- routes
- Durable Objects
- Queues
- D1
- KV
- R2
- external providers
- deployments

Required signals:

- request rate
- error rate
- latency histogram
- p95/p99 latency
- queue depth
- queue age
- retry count
- dead-letter count
- D1 query error rate
- KV read/write error rate
- R2 upload/download error rate
- DO init/fetch/snapshot failures
- provider error rate
- provider latency

### FR-002 — LLM/agent tracing

The system must trace LLM and agent activity in Langfuse.

Required fields when available:

- tenant_id
- request_id
- trace_id
- agent_run_id
- model_provider
- model_name
- model_version
- prompt_hash
- token_input
- token_output
- estimated_cost
- tool_name
- tool_status
- error_code
- duration_ms

### FR-003 — LLM eval/debug

The system must support Arize Phoenix for offline evals and debugging.

Phoenix must not be the primary production trace source unless explicitly upgraded in a later version.

### FR-004 — Edge analytics

The system must use Cloudflare for edge, traffic, bot, and threat analytics.

Cloudflare must remain the primary source for:

- edge request traffic
- bot activity
- WAF events
- threat detection
- CDN/cache behavior

### FR-005 — Business/audit events

EdgeGDE must retain authoritative business/audit events in AuditLedger_DO.

D1 projections may be used for querying and dashboards.

Audit events must include:

- event_id
- tenant_id
- sequence
- timestamp
- event_type
- actor_type
- actor_id or system
- correlation_id
- payload_hash
- payload or compact metadata
- previous_hash or chain metadata

### FR-006 — Telemetry correlation

Telemetry must support correlation across systems using stable identifiers.

Minimum identifiers:

- request_id
- trace_id
- tenant_id
- job_id when async
- agent_run_id when agent-driven
- audit_event_id when business/audit event exists

### FR-007 — Redaction

Telemetry must redact or omit:

- secrets
- API keys
- bearer tokens
- passwords
- HMAC keys
- full credentials
- full request bodies by default
- full prompts by default
- full LLM responses by default
- raw KYC/document content
- unredacted PII unless explicitly approved

### FR-008 — Cardinality control

Metrics labels must use bounded values.

Allowed metric labels:

- route_template
- status_class
- provider_name
- model_name
- queue_name
- do_name
- tenant_tier or tenant_class

Avoid metric labels:

- raw user_id
- raw email
- raw phone
- raw URL
- raw tenant_id for high-cardinality metrics
- raw error message
- request_id

### FR-009 — Dashboard ownership

Dashboards must have a single owner per concern.

Recommended ownership:

- SigNoz owns infrastructure health dashboards
- Langfuse owns LLM/agent production trace dashboards
- Phoenix owns eval/debug dashboards
- Cloudflare owns edge/security dashboards
- EdgeGDE owns business/audit dashboards

### FR-010 — Alert ownership

Alerts must be symptom-based and actionable.

Recommended page-worthy alerts:

- user-facing Worker error rate above threshold
- p95/p99 Worker latency above threshold
- queue age above threshold
- D1 write failure rate above threshold
- KV/R2/DO failures increasing
- AuditLedger append failures
- LLM provider outage or timeout spike
- deployment/build failure
- Cloudflare WAF/bot spike requiring action

Dashboard-only alerts:

- CPU/memory utilization
- token volume
- provider latency trends
- bot traffic trends
- forecast error trends
- model eval regression trends

## 6. Storage Model

### Control Plane / Query Plane

Type: D1

Used for:

- finalized relational data
- queryable projections
- business metrics
- audit snapshots
- forecast projections when forecasting is added later

### Active State

Type: Durable Objects

Used for:

- AuditLedger_DO append-only event truth
- active session state where required
- strongly consistent ordering

### Pointer / Config Layer

Type: KV

Used for:

- tenant config
- small indexes
- pointers to latest artifacts
- latest telemetry dashboard/config pointers if needed

Forbidden:

- large telemetry payloads
- large JSON blobs
- raw trace payloads
- raw LLM payloads
- KV listing in runtime paths

### Object Storage

Type: R2

Used for:

- large artifacts
- exports
- generated reports
- binary objects

### External Observability

Used for:

- SigNoz logs/metrics/traces
- Langfuse LLM/agent traces
- Phoenix eval/debug data
- Cloudflare edge analytics/logs

## 7. Event Taxonomy

v1.0.0 defines the event categories that must be supported.

### Infrastructure events

- worker_request_started
- worker_request_completed
- worker_request_failed
- queue_job_started
- queue_job_completed
- queue_job_failed
- queue_job_retried
- do_init_failed
- do_fetch_failed
- do_snapshot_failed
- d1_query_failed
- kv_read_failed
- kv_write_failed
- r2_upload_failed
- r2_download_failed
- deployment_started
- deployment_completed
- deployment_failed

### LLM/agent events

- agent_run_started
- agent_run_completed
- agent_run_failed
- llm_call_started
- llm_call_completed
- llm_call_failed
- tool_call_started
- tool_call_completed
- tool_call_failed
- eval_run_started
- eval_run_completed
- eval_run_failed

### Business/audit events

- tenant_created
- tenant_updated
- form_submitted
- contact_resolved
- lead_scored
- stage_changed
- alert_created
- alert_dispatched
- alert_dismissed
- document_uploaded
- document_downloaded
- document_deleted
- webhook_received
- webhook_dispatched
- audit_event_appended
- projection_refreshed

### Forecast events, deferred until forecasting implementation

- forecast_run_started
- forecast_run_completed
- forecast_run_failed
- forecast_projection_published
- forecast_projection_deprecated

## 8. API / Admin Surface

v1.0.0 does not require new public APIs unless an existing dashboard needs them.

Potential admin endpoints for later implementation:

- GET /api/v1/admin/telemetry/infrastructure
- GET /api/v1/admin/telemetry/llm
- GET /api/v1/admin/telemetry/audit
- GET /api/v1/admin/telemetry/forecasting
- POST /api/v1/admin/telemetry/redaction-test

These endpoints must preserve tenant isolation and admin auth.

## 9. Dashboard Requirements

### Infrastructure dashboard

Must show:

- Worker request rate
- Worker error rate
- p95/p99 latency
- Queue depth and age
- D1/KV/R2/DO errors
- deployment status
- external provider errors

Owner: SigNoz

### LLM/agent dashboard

Must show:

- agent run counts
- LLM call counts
- provider latency
- token usage
- estimated cost
- tool call success/failure
- model/provider error rate

Owner: Langfuse

### Eval/debug dashboard

Must show:

- eval run results
- regression indicators
- dataset coverage
- model/prompt comparisons

Owner: Phoenix

### Edge/security dashboard

Must show:

- traffic volume
- bot activity
- WAF blocks
- threat patterns
- geography
- cache/CDN behavior

Owner: Cloudflare

### Business/audit dashboard

Must show:

- tenant-scoped business events
- audit event counts
- lead scoring outcomes
- alert lifecycle
- webhook dispatch status
- projection refresh status

Owner: EdgeGDE

## 10. Security & Privacy Requirements

- No secrets in telemetry.
- No full request bodies by default.
- No full prompts/responses by default.
- No KYC/document content in third-party telemetry.
- No cross-tenant telemetry leakage.
- Admin telemetry endpoints require admin auth.
- Tenant telemetry views require tenant auth or explicit admin override.
- Raw tenant_id may appear in logs/traces for debugging, but should not be used as a high-cardinality metric label.
- Redaction must happen before telemetry leaves EdgeGDE.

## 11. Forecasting Research Track

Forecasting is explicitly deferred from v1.0.0 implementation.

v1.0.0 only starts the research track.

Research goal:

Find the best forecasting solution for EdgeGDE's architecture, data shape, tenant isolation requirements, latency/cost constraints, and projection/audit model.

TimesFM 2.5 is a candidate only.

Forecasting research must compare at least:

- seasonal naive
- moving average
- ARIMA / ETS
- Prophet or similar
- gradient boosted trees with lag features
- BigQuery ML TimesFM
- open TimesFM 2.5
- Darts
- Nixtla StatsForecast / MLForecast / NeuralForecast
- PyTorch Forecasting
- Amazon Forecast, if managed AWS is acceptable
- ensemble approaches

Forecasting evaluation criteria:

- accuracy on EdgeGDE-relevant series
- latency
- cost
- tenant isolation
- operational complexity
- explainability
- covariate support
- uncertainty/quantile support
- backtesting support
- deployment fit
- managed vs self-hosted tradeoff
- support/maintenance burden

Forecasting must follow the projection invariant:

Forecast outputs are versioned materialized projections, not authoritative truths.

## 12. Acceptance Criteria for v1.0.0

Telemetry & Analytics v1.0.0 is functionally complete when:

- SigNoz is designated primary infrastructure observability backend
- Langfuse is designated production LLM/agent trace backend
- Phoenix is designated eval/debug backend
- Cloudflare is designated edge/web/security analytics source
- EdgeGDE AuditLedger/D1 is designated business/audit telemetry source
- telemetry ownership boundaries are documented
- redaction rules are documented
- cardinality rules are documented
- forecasting is explicitly excluded from implementation scope
- forecasting research track is started
- no third-party telemetry source is allowed to own EdgeGDE state
- no telemetry source is allowed to receive secrets or full sensitive payloads by default

## 13. Open Questions for v1.1

- What exact Cloudflare Logpush/export path is required?
- What SigNoz retention and ingestion budget is acceptable?
- What Langfuse retention and redaction policy is required?
- Which telemetry events must be visible in EdgeGDE admin dashboards versus external dashboards?
- What SLOs define page-worthy alerts?
- What tenant telemetry isolation model is required for admin views?
- What forecasting data series exist today?
- What forecasting horizon and latency are required?
- What business cost function should rank forecasting candidates?
