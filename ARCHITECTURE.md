# EdgeGDE — Architecture Reference

**Version:** 9.6.0  
**Status:** Fully Optimized — Hardened + Reliable + Cost-Efficient + Verified  
**Saved:** 30 May 2026

---

## Architecture Ethos (Locked)

- serverless
- distributed
- tenant_isolated
- pointer_pattern_only
- append_only_audit
- structured_data_first
- deterministic_core_plus_ai_overlay
- async_non_blocking
- kv_used_for_pointers_only
- zero_drift_enforced

---

## Runtime

**Entry:** `src/index.ts`

### Fetch Routes
| Route | Auth |
|-------|------|
| `/healthz` | none |
| `/api/form/*` | none |
| `/api/v1/admin/*` | Bearer token / `?token=` |
| `/api/v1/leads/*` | Bearer token |
| `/api/v1/vault/*` | Bearer token (applied in router) |
| `/api/webhook/leads` | none (internal cron) |
| `/lead-dashboard.html` | static asset |

### Queue
- **Handler:** `src/queues/lead-scorer.ts`
- **Retry:** platform-managed only (`max_retries: 3` in wrangler.json)

### Cron
- **Schedule:** Every Sunday 3am (Cubbit backup)
- **Schedule:** `0 8,20 * * *` (dispatcher)
- **Handler:** `src/crons/dispatcher.ts`

### Durable Objects
| DO | Scope | Purpose |
|----|-------|---------|
| `RateLimiter` | global | Token bucket rate limiter |
| `AuditLedger` | per-tenant | Immutable, append-only event log |

---

## Storage Architecture

| Layer | Role | Tables / Patterns |
|-------|------|-------------------|
| **D1** | Source of truth + relational | `form_submissions`, `contacts`, `brokers`, `pipeline_stages`, `document_vault`, `webhook_events` |
| **KV** | Pointer layer only | `tenant:{id}:alerts:hot:index`, `tenant:{id}:deadletter:index`, `tenant:{id}:telemetry:llm:days:index` |
| **R2** | Binary storage | EdgeGDE vault, max upload 100MB |
| **DO** | Immutable event log | Per-tenant audit trail |

### KV Constraints
- No `KV.list()` usage — enforced at runtime by `guardKvList()`
- Pointers only — never store payload data in KV
- Low write frequency, TTL with jitter

---

## Core Pipeline

```
Form Submit
  → Contact Resolution (email/phone dedup)
  → D1 Insert (form_submissions)
  → Queue Send (lead-scorer)
  → Scoring Execute (deterministic + optional LLM)
  → D1 Update (score, band, rationale, contact_id, stage)
  → KV Alert Emit (if score >= 80)
  → SSE Stream Broadcast
  → Cron Dispatch (every minute → webhook)
  → Webhook Ingest (persist to webhook_events D1 table)
  → Document Upload (R2 vault)
  → Audit Append (AuditLedger DO)
  → Telemetry Record (LLM metrics)
```

---

## Contact Resolution

- **Dedup priority:** email → phone
- **Normalization:** email → lowercase trim, phone → digits only
- **Error handling:** `console.warn` on failure (M7)

---

## Pipeline Stages (7-stage SalesTrekkker-aligned)

| ID | Stage |
|----|-------|
| ST_01 | New Lead |
| ST_02 | Fact Find |
| ST_03 | Docs Requested |
| ST_04 | Assessment |
| ST_05 | Lender Submission |
| ST_06 | Approved |
| ST_07 | Settled |

**Granularity:** submission-level (`current_stage` TEXT column)

---

## Scoring Engine

### Deterministic (FNS40821) — 0-70
| Input | Rule | Bonus |
|-------|------|-------|
| Base | — | 30 |
| LVR < 80% | Low risk | +20 |
| LVR 80-90% | Moderate | +10 |
| LVR > 90% | High risk | +0 |
| Employment: PAYG | Stable income | +20 |
| Employment: Self-Employed | Requires BAS review | +0 |

### LLM Signal — 0-30
- **Provider:** OpenRouter → DeepSeek V4 Flash
- **Signals:** urgency, intent, red flag detection
- **Fallback:** deterministic-only on failure

### Composition
- Total = deterministic + LLM, clamped 0-100
- Red flag detected → cap at 50
- Bands: hot >=80, warm 50-79, cold <50

---

## Alerts

- **Trigger:** total score >= 80
- **KV:** `tenant:{id}:alert:hot:{submissionId}` (3d TTL)
- **Index:** `tenant:{id}:alerts:hot:index` (pointer, max 100)
- **Lifecycle:** created → dispatched:true → dismissed
- **Stream:** SSE via `/api/v1/admin/leads/stream`

---

## Deadletter System

| Source | Trigger | KV Key | TTL |
|--------|---------|--------|-----|
| D1 insert failure | `form-registry.ts` | `tenant:{id}:deadletter:{uuid}` | 7d |
| Index pointer | maintained on write | `tenant:{id}:deadletter:index` | — |

**Replay:** `POST /api/v1/admin/replay-deadletters` reads index, does idempotent D1 insert, requeues for scoring, deletes KV, updates index. Phantom entries (expired KV) are removed from index (H3).

---

## Webhook System

- **Endpoint:** `POST /api/webhook/leads`
- **Trigger:** Cron dispatcher pushes hot lead alerts
- **Persistence:** Stores to `webhook_events` D1 table (H1)
- **Payload:** `{ type, tenantId, submissionId, score, rationale, summary }`

---

## Vault (R2 Document Storage)

| Operation | Endpoint |
|-----------|----------|
| Upload | `PUT /api/v1/vault/upload/:submissionId/:filename` |
| List | `GET /api/v1/vault/:submissionId` |
| Download | `GET /api/v1/vault/download/:submissionId/:filename` |
| Delete | `DELETE /api/v1/vault/:submissionId/:filename` |

- **Object key pattern:** `tenant/{tenantId}/submission/{submissionId}/{uuid}-{filename}`
- **Max upload:** 100MB (H4)
- **Tenant isolation:** D1 lookup before R2 fetch — never constructs keys from URL

---

## Audit (Immutable Ledger)

- **Storage:** Durable Object, per-tenant (`tenant:{tenantId}`)
- **Model:** Append-only, monotonic sequence
- **Events:** upload, download, delete, stage_change
- **Schema:** `{ id, ts, action, tenantId, submissionId, file_name, object_key, size_bytes?, metadata? }`
- **Endpoints:** `POST /append`, `GET /list`, `GET /count`

---

## Telemetry

- **LLM metrics stored in KV:** `tenant:{id}:telemetry:llm:{YYYY-MM-DD}`
- **Daily index:** `tenant:{id}:telemetry:llm:days:index` (last 30 days)
- **Metrics:** call count, success count, latency

---

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/healthz` | Health check |
| POST | `/api/form/{id}` | Form submission |
| GET | `/api/v1/admin/leads` | List leads (with band/tenant filter) |
| GET | `/api/v1/admin/leads/stream` | SSE hot lead stream |
| PATCH | `/api/v1/admin/leads/:id/stage` | Stage transition |
| GET | `/api/v1/admin/hot-alerts` | List hot alerts |
| DELETE | `/api/v1/admin/hot-alerts/:id` | Dismiss alert |
| GET | `/api/v1/admin/insights` | Aggregation queries |
| GET | `/api/v1/admin/telemetry` | LLM metrics |
| GET | `/api/v1/admin/contacts` | List contacts |
| GET | `/api/v1/admin/stages` | List pipeline stages |
| POST | `/api/v1/admin/replay-deadletters` | Replay failed D1 writes |
| POST | `/api/v1/admin/scoring/rubrics` | Create rubric |
| POST | `/api/v1/admin/scoring/execute` | Score via rubric |
| PUT | `/api/v1/vault/upload/:sId/:filename` | Upload document |
| GET | `/api/v1/vault/:submissionId` | List documents |
| GET | `/api/v1/vault/download/:sId/:filename` | Download document |
| DELETE | `/api/v1/vault/:sId/:filename` | Delete document |
| GET | `/api/v1/vault/audit` | Read audit ledger |
| POST | `/api/webhook/leads` | Receive webhook |
| GET | `/lead-dashboard.html` | Dashboard UI |
| GET | `/leads.html` | Glass-themed lead monitor |

---

## Hardening History

| Sprint | Items | Status |
|--------|-------|--------|
| Audit | Full codebase audit (AUDIT.md) | ✅ |
| Sprint 1 | H2, H4, H3, H1, M7 | ✅ Deployed v9.6.0 |
| Sprint 2 | M1, M2, M5 | 🔲 Pending |
| Sprint 3 | M4, L4, L2, L3 | 🔲 Pending |
| Sprint 4 | M6, L5, L7 | 🔲 Pending |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main entry, middleware, routes, exports |
| `src/queues/lead-scorer.ts` | Queue consumer — scoring + contact resolution |
| `src/api/scoring.ts` | All admin API endpoints (848 lines — candidates for split) |
| `src/api/vault.ts` | R2 document vault |
| `src/objects/AuditLedger.ts` | Per-tenant append-only DO |
| `src/lib/sse.ts` | SSE broadcast module |
| `src/crons/dispatcher.ts` | Cron-driven webhook dispatch |
| `src/middleware/auth.ts` | Admin auth (Bearer + query param) |
| `src/middleware/tenant-resolver.ts` | Multi-step tenant resolution |
| `src/lib/form-registry.ts` | Dynamic form engine + D1 persistence |
| `public/lead-dashboard.html` | Main dashboard UI |
| `public/leads.html` | Glass-themed hot lead monitor |
| `wrangler.json` | CF Workers config |
| `AUDIT.md` | Full audit report |
