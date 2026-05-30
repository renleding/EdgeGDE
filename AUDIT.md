# EdgeGDE — Deep Audit Report

**Date:** 30 May 2026  
**Version audited:** v9.4.0 (deployed commit `3e434dc1`)  
**Scope:** Full codebase, config, migrations, workflows, architecture  
**Files audited:** 18 source files, 6 migrations, 3 configs, 2 HTML dashboards, 2 Durable Objects  
**Ethos Score:** **96/100**

---

## 1. Architecture Overview

EdgeGDE is a Cloudflare Workers-based mortgage lead management platform running on Hono. It processes form submissions through an async scoring pipeline (FNS40821 deterministic engine + DeepSeek V4 Flash LLM signal), manages hot lead alerts via KV index pointers, provides a document vault via R2, and maintains an append-only audit trail via Durable Objects. The system serves 3+ tenants across 14 database tables, 3 KV namespaces, 1 R2 bucket, and 2 Durable Object classes.

### Core Data Flow

```
Form Submit → D1 Insert → Queue → Scoring (Deterministic + LLM) → D1 Update
                ↓                          ↓
          Deadletter KV               Alert KV → SSE Stream → Dashboard
                                          ↓
                                    Cron Dispatcher → Webhook
```

---

## 2. Ethos Alignment Breakdown

| EdgeGDE Principle | Score | Evidence |
|---|---|---|
| Serverless-first | 100/100 | Pure Cloudflare Workers + D1 + KV + R2 + Queues + DO. No servers. |
| Tenant isolation | 95/100 | `WHERE tenant_id = ?` on every D1 query. KV keys prefixed `tenant:{id}:`. Resolver middleware gates all routes. Dashboard hardcodes `afirmico` tenant — should be configurable. |
| Pointer-pattern only | 100/100 | `guardKvList()` overrides `KV.list()` at runtime to throw descriptive errors. All iteration uses KV index pointers or D1 queries. |
| Append-only audit | 100/100 | AuditLedger DO is per-tenant append-only with monotonic sequencing. Immutable log. |
| Structured data first | 90/100 | D1 primary for relational data. KV for alerts/pointers only. However, form submissions still store payload as JSON blob rather than normalized columns. |
| Async non-blocking | 95/100 | Queue-based scoring, `waitUntil()` for D1 writes and audit events. The contact resolution in the queue consumer is synchronous but inside an async context. |
| Deterministic core + AI overlay | 100/100 | FNS40821 engine (pure function, 0-70) + optional DeepSeek LLM (0-30). LLM failure degrades gracefully to deterministic-only. |
| Zero drift | 85/100 | See risk items below — deadletter phantom entries, stale tenant queries, cobweb cron loop. |
| **Overall** | **96/100** | **Strong alignment. The pointer-pattern enforcement via runtime guard is a novel and effective pattern.** |

---

## 3. Risk Register

### 🔴 HIGH — Address within 1 sprint

#### H1 — Self-referencing webhook loop (src/crons/dispatcher.ts:56-72)

**Risk:** The `ALERT_WEBHOOK_URL` is set to `https://edgegde-calculator.renleding.workers.dev/api/webhook/leads`. The cron dispatcher reads KV alerts, POSTs the full payload (name, email, loan amount, employment) back to the same worker's `/api/webhook/leads` endpoint, which logs and returns 200. This is a closed loop — the data goes nowhere useful. The full form payload is serialized and transmitted in this loop every minute for every undispatched hot lead.

**Impact:** Unnecessary bandwidth and compute. The webhook endpoint could be a useful data pipeline if it stored to D1, but currently it's just a log statement.

**Fix:** Either:
- (a) Remove the cron loop and use SSE only (simpler, no external dependency)
- (b) Make `/api/webhook/leads` store received payloads to a `webhook_events` D1 table for later retrieval

---

#### H2 — `SELECT *` returns raw PII payload (src/index.ts:436)

**Risk:** The `/api/admin/leads/:tenantId` endpoint uses `SELECT * FROM form_submissions` which returns the raw `payload` JSON column containing full PII — name, email, phone, income, loan amounts, employment details. While admin-auth-gated, this is unnecessary data surface area.

**Impact:** PII exposure via any admin-authorized client. A developer's browser devtools or a compromised admin token gets the full payload for every lead.

**Fix:** Replace `SELECT *` with explicit column selection:
```sql
SELECT id, lead_score, score_band, score_rationale, contact_id, current_stage, created_at
```

---

#### H3 — Deadletter phantom entries accumulate (src/api/scoring.ts, replay endpoint)

**Risk:** The deadletter replay endpoint deletes KV items and rewrites the index, but if a KV item has already expired (7d TTL) or was manually deleted, it stays in the index pointer forever as a phantom entry. Over time the index grows with stale references.

**Impact:** Each time the replay endpoint runs, it fetches phantom entries, gets `null` back, and skips them — but the index never shrinks. With active form submissions hitting D1 failures, this accumulates.

**Fix:** After iterating the batch, filter out any submission IDs where the KV payload was `null` (expired/deleted) and rewrite the index without them.

---

#### H4 — No vault upload size limit (src/api/vault.ts)

**Risk:** Vault uploads stream directly from `request.body` to R2 with no content-length check. A malicious or accidental 5GB upload consumes R2 storage and incurs cost before any safeguard.

**Impact:** Unbounded R2 storage costs. A single large upload could exceed free tier limits.

**Fix:** Check `Content-Length` header before streaming:
```ts
const cl = c.req.header('content-length')
if (cl && parseInt(cl) > 50 * 1024 * 1024) {
  return c.json({ error: 'File exceeds 50MB limit' }, 413)
}
```

---

### 🟡 MEDIUM — Address within 2-3 sprints

#### M1 — Scoring engine has zero test coverage
**File:** `src/lib/scoring-engine.ts`, `src/queues/lead-scorer.ts`  
**Impact:** A regression in the FNS40821 deterministic engine or rubric engine would silently produce wrong scores. No test suite catches it.  
**Fix:** Write tests for `computeDeterministic()` (pure function, easy to test) and the LLM response parsing.

#### M2 — Queue retry logic conflict
**File:** `src/queues/lead-scorer.ts:337`  
**Impact:** `msg.retry({ retriesLeft: ... })` on top of platform `max_retries: 3` from wrangler.json. This creates a double-retry layer — a message could be retried up to 9 times.  
**Fix:** Remove manual retry count. Let the platform manage retries via `max_retries`.

#### M3 — SSE subscriber leak on eviction
**File:** `src/lib/sse.ts`  
**Impact:** Module-scoped `Set<SseSubscriber>` is cleaned on `abort` events but can leak if the Worker isolate is evicted ungracefully. Browser-side `EventSource` auto-reconnects, so practical impact is low.  
**Fix:** Add a heartbeat sweep that removes stale writers. Low priority.

#### M4 — Extensive `any` types
**Files:** All  
**Impact:** `(c.env as any)` appears ~80 times across the codebase. A future D1 or KV API change would not be caught at compile time.  
**Fix:** Create typed interfaces for the `Env` bindings and use `c.env` with proper typing.

#### M5 — Tenant list fetched every 60 seconds
**File:** `src/crons/dispatcher.ts:26`  
**Impact:** `SELECT DISTINCT tenant_id FROM form_submissions` runs every minute regardless of whether new submissions exist. Wasteful D1 read churn at scale.  
**Fix:** Cache tenant list in KV with a timestamp. Only refresh if new submissions exist or cache is stale.

#### M6 — Empty fields in stage-change audit events
**File:** `src/api/scoring.ts` (PATCH stage)  
**Impact:** Stage changes log `file_name: ''` and `object_key: ''` which are noise in the audit trail.  
**Fix:** Omit unused fields from stage-change audit events, or set them to meaningful values.

#### M7 — Silent catch on contact resolution failure
**File:** `src/queues/lead-scorer.ts:268`  
**Impact:** Empty `catch {}` swallows all D1 errors during contact creation/lookup. A missing contacts table or schema mismatch goes completely undetected.  
**Fix:** Add `console.warn('[contact] resolution failed:', err)`.

---

### 🟢 LOW — Address opportunistically

| ID | Issue | File | Fix |
|---|---|---|---|
| L1 | GuardKvList silent failure on frozen objects | `src/index.ts:81` | Add descriptive log when guard can't patch |
| L2 | No pagination on leads endpoint | `src/api/scoring.ts:422` | Add cursor/offset query params |
| L3 | Multiple MemoryKvStore instances | 3 files | Export singleton from `publish.ts` |
| L4 | z.coerce.number() accepts empty string as 0 | `src/lib/schemas.ts:118` | Add explicit empty-string rejection |
| L5 | No CORS headers | `src/index.ts` | Add CORS middleware |
| L6 | Static admin pages unauthenticated | `public/*.html` | Acceptable with `?token=` pattern |
| L7 | Brokers table exists but no API | `src/api/` | Build CRUD endpoints |

---

## 4. Code Quality Observations

### Strengths
- **Pointer-pattern compliance via runtime guard** — `guardKvList` is a novel enforcement mechanism. The system throws descriptive errors if any code path ever calls `KV.list()`.
- **Circuit breakers at every boundary** — D1 failure → deadletter. LLM failure → deterministic fallback. Compile failure → stale KV cache → safe HTML. Queue failure → retry → DLQ.
- **Fire-and-forget discipline** — `waitUntil()` used correctly throughout. No slow-path work blocks API responses.
- **Tenant isolation is genuinely strict** — every D1 query includes `WHERE tenant_id = ?`. Every KV key is prefixed `tenant:{id}:`.
- **Durable Object for audit** — per-tenant append-only DO is the correct tool for immutable event logging.

### Weaknesses
- **File bloat:** `scoring.ts` (848 lines), `index.ts` (757 lines). Scoring router should be split into scoring/alerts/insights/contacts/stages modules.
- **Mixed concerns in index.ts:** Contains 130+ lines of inline HTML/CSS/JS template strings, API route handlers, and middleware setup.
- **Dead code:** The `POST /scoring/rubrics`, `POST /scoring/execute`, and related rubric endpoints exist but the active pipeline uses the FNS40821 engine in the queue consumer. Rubric tables are untested unless used externally.
- **Zero integration tests:** Only `packages/op-schema/tests/` has test files. Every deploy is a blind push.

---

## 5. Action Plan

### Sprint 1 (~4h) — Security & Data Integrity
```
#[H1] Close self-referencing webhook loop
     → Remove cron dispatch or make webhook endpoint store to D1

#[H2] Stop returning raw PII payload
     → Replace SELECT * with explicit column list

#[H4] Add vault upload size limit
     → Check Content-Length before streaming

#[M7] Surface contact resolution errors
     → Add console.warn to empty catch block
```

### Sprint 2 (~6h) — Reliability & Performance
```
#[H3] Fix deadletter phantom index entries
     → Filter expired KV items during replay, rewrite index

#[M1] Add scoring engine tests
     → Test computeDeterministic() + LLM response parser

#[M2] Fix queue retry logic
     → Remove manual retry count, let platform manage

#[M5] Cache tenant list in dispatcher
     → KV cache with staleness check
```

### Sprint 3 (~6h) — Code Quality
```
#[M4] Type bindings properly
     → Create typed Env interface for all CF resources

#[L4] Fix empty-string coercion in forms
     → Reject empty strings for number fields

#[L2] Add pagination to leads endpoint
     → cursor/offset query params

#[L3] Unify MemoryKvStore singletons
     → Single export from publish.ts
```

### Sprint 4 (~4h) — Feature Polish
```
#[M6] Clean stage-change audit payload
     → Omit empty file_name/object_key

#[L5] Add CORS middleware
     → Allow UIBuilder origin

#[L7] Build broker CRUD endpoints
     → Table exists, needs API
```

**Total remediation:** ~20 hours  
**Current state:** Production-viable. All items are hardening/quality improvements, not blockers.
