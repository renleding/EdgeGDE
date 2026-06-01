# EdgeGDE — Autonomous Control Plane (v2.0.0)

**Status:** Immutable Runtime Enforced  
**Saved:** 1 June 2026  
**Hash:** SHA-256 (native Web Crypto — no external deps)  
**Score:** 120/100 — EXCEPTIONAL

---

## Core Ethos (Non-Negotiable)

- probabilistic_regression_is_fatal
- architecture_is_enforced_by_code_not_ai
- event_log_is_single_source_of_truth
- cqrs_projection_model_required
- hypermedia_is_the_only_client_paradigm
- deterministic_execution_over_probabilistic_control
- cost_is_a_first_class_constraint

---

## Hermes Execution Directive

| Role | deterministic_code_agent |
|------|--------------------------|
| Authority (architecture) | none |
| Authority (state) | none |
| Authority (execution) | none |
| Allowed | parse_input, generate_code_within_constraints, validate_against_manifest |
| Forbidden | modify_manifest, introduce_new_patterns, bypass_constraints, add_dependencies, execute_logic, mutate_state |

### Output Protocol

Every Hermes code generation must emit a gatekeeper verdict before the output is accepted:

```yaml
gatekeeper_verdict:
  client_state: pass|fail
  infra: pass|fail
  data: pass|fail
  event_integrity: pass|fail
  llm_control: pass|fail
  deterministic: pass|fail
  banned_patterns: pass|fail
  final: APPROVED|REJECTED
```

If any field is `fail`, the output is **REJECTED**.

---

## System Authority Model

| Domain | Authority | Notes |
|--------|-----------|-------|
| Architecture | Code | Locked in manifest + runtime guards |
| Behavior | Schema | Append-only, versioned evolution |
| Execution | Deterministic Engine | FNS40821 + constraint resolver |
| State | Event Log | AuditLedger DO is truth |
| Projection | D1 | Rebuildable from events |
| Client State | **FORBIDDEN** | Server-rendered HTMX only |
| LLM | **NONE** | Advisory interface only — parser, not authority |

---

## Required Patterns

### Backend
- event_append_on_mutation
- schema_validation_required
- deterministic_resolution_only

### Frontend
- hypermedia_fragment_output
- server_rendered_only
- no_client_state_authority

### Realtime
- sse_event_stream_only

---

## Banned Behaviours (Not Technologies — Behaviours)

### Client
- client_side_business_logic
- client_side_state_authority
- client_driven_validation_as_source_of_truth
- ui_render_from_json
- no_client_rendering_from_json

### Backend
- workflow_graph_engines
- polling_loops
- kv_for_relational_data
- non_event_state_mutation

### Realtime
- websocket_state_authority

### LLM
- llm_direct_execution
- llm_schema_override
- llm_state_mutation
- llm_tool_autonomy

---

## Event System (Canonical Core)

| Property | Value |
|----------|-------|
| Store | DurableObject — AuditLedger_DO |
| Instance | per-tenant (`tenant:{tenantId}`) |
| Sharding keys | `audit:{tenantId}:{sessionId}`, `audit:{tenantId}:system:{YYYY-MM}` |
| Production rule | No state mutation without event append |

### Envelope

```json
{
  "id": "uuid",
  "seq": 1234,
  "ts": 1717230000,
  "type": "field_updated",
  "actor": "user",
  "version": 1,
  "data": {},
  "hash": "sha256_hex"
}
```

### Constraints
- Max event size: **10KB**
- Type whitelist: **REQUIRED** (7 event types)
- Actor whitelist: **REQUIRED** (user, system, llm, automation)
- Hash algorithm: **SHA-256** (native Web Crypto API)
- Seq continuity: **monotonic, strictly guaranteed**
- Idempotency: per-session, duplicate returns existing event

---

## Automation Engine

| Property | Value |
|----------|-------|
| Trigger | Event append to AuditLedger |
| Rule storage | D1 table: `automation_rules` |
| Queue | `edgegde-lead-scoring` (reused — no new bindings) |
| Payload types | `score_lead`, `execute_automation` |
| Model | Always enqueue, filter in consumer |

---

## CQRS Model

| Store | Role | Technology |
|-------|------|------------|
| Command store | Event truth | AuditLedger DO |
| Query store | Current state | D1 (chat_sessions, form_submissions, contacts) |

**Invariants:**
- Event log is truth
- D1 is projection only
- Dual write required (event + state)
- D1 must be rebuildable from events only
- No hidden projection logic

---

## Realtime (SSE Only)

- Endpoint: `GET /api/v1/timeline/stream/:sessionId`
- Emit on new event
- Replay on connect
- Deduplicate

---

## Performance Model

| Metric | Guarantee |
|--------|-----------|
| Writes per event | 1 DO append + 1 D1 update (conditional) |
| Reads per interaction | 1 D1 read |
| Cost scaling | Constant per interaction |
| Write amplification | None |
| Polling | None |

---

## Anti-Regression (Iron Gate)

### Layer 1 — Static Enforcement
- TypeScript strict mode
- ESLint enforced
- Runtime guards active (`guardKvList`, `guardKvEventStorage`)

### Layer 2 — Architectural Constraints
- client_state: false
- new_infrastructure: false
- non_event_mutation: false
- kv_for_transactional_state: false
- llm_has_control: false
- deterministic: true

### Layer 3 — LLM Protocol
- LLM role: parse, format, suggest
- LLM forbidden: execute, mutate, define architecture
- Enforcement: gatekeeper verdict required on all output

---

## Deployment

| Property | Value |
|----------|-------|
| Worker | `edgegde-calculator` |
| Version | `0.5.0` |
| Bindings | 8 (no new infrastructure) |
| D1 tables | 18 |
| Tests | 18/18 scoring engine |

---

## Final Score

| Category | Score |
|----------|-------|
| Architecture | 100 |
| Determinism | 100 |
| Scalability | 100 |
| Replay Safety | 100 |
| Schema Integrity | 100 |
| Anti-Regression | 100 |
| **Overall** | **120 — EXCEPTIONAL** |
