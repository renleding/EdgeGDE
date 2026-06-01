# KV Storage Audit — edgegde-calculator
## Classification of Every KV Key

### CATEGORY A — Ephemeral Signals → KV ✅ (correct placement)

| Key Pattern | Namespace | Op | Purpose | Where | Classification |
|---|---|---|---|---|---|
| `tenant:{id}:alerts:hot:index` | TENANT_KV | GET/PUT/DEL | Hot alert pointer index | lead-scorer, scoring, dispatcher | ✅ Pointer only — keep |
| `tenant:{id}:alert:hot:{subId}` | TENANT_KV | GET/PUT/DEL | Hot alert payload | lead-scorer, scoring | ⚠️ MOVE to D1 (Category B) |
| `tenant:{id}:nurture:{subId}` | TENANT_KV | GET/PUT | Cold lead nurture tag | lead-scorer | ⚠️ MOVE to D1 (category flag) or use D1 column |
| `tenant:{id}:deadletter:{uuid}` | TENANT_KV | GET/PUT/DEL | Failed D1 insert backup | form-registry | ⚠️ MOVE to D1 |
| `tenant:{id}:deadletter:index` | TENANT_KV | GET/PUT | Dead letter pointer | form-registry | ✅ OK as index if payloads move to D1 |
| `tenant:{id}:webhook` | TENANT_KV | GET/PUT/DEL | Webhook config | api/tenants | ✅ Config pointer — keep |
| `deprecated:tenant_query:{date}` | TELEMETRY_KV | GET/PUT | Usage telemetry (daily-gated) | tenant-resolver | ✅ Daily signal — keep |
| `{todayKey}` | TELEMETRY_KV | GET/PUT | Daily deprecation log | tenant-resolver | ✅ Daily signal — keep |

### CATEGORY B — High-Frequency Updates → MOVE TO D1 🔴

| Key Pattern | Namespace | Op | Purpose | Where | KV Ops/Day (est.) | Fix |
|---|---|---|---|---|---|---|
| `tenant:{id}:telemetry:llm:{date}` | TELEMETRY_KV | GET/PUT | Per-LLM-call telemetry array | lead-scorer | N×(GET+PUT) | Move to D1 `telemetry_daily`: tenant_id, date, llm_calls, success_count, total_latency, red_flag_count |
| `tenant:{id}:telemetry:llm:days:index` | TELEMETRY_KV | GET/PUT | Telemetry daily index | lead-scorer | 2×(GET+PUT) | Derivable from D1 — DELETE |
| `metrics:{tenant}:{tool}` | TENANT_KV | GET/PUT | Per-request metrics accumulator | metrics (middleware) | N×(GET+PUT) — **BROKEN**, never flushes | Move to AnalyticsDO + hourly D1 flush |
| `score_trace:{tenant}:{lead}:{rubric}` | TENANT_KV | PUT | Scoring trace/audit trail | api/scoring | 1 per manual score | Move to D1 `score_traces` table |

### CATEGORY A — Layout Config → KV ✅ (correct as cache/pointer)

| Key Pattern | Namespace | Op | Purpose | Where | Classification |
|---|---|---|---|---|---|
| `tenant:{id}:layout:latest` | TENANT_KV | GET/PUT | Current layout pointer | index, publish, resolver | ✅ Read-heavy, write-rare config |
| `tenant:{id}:layout:{tool}:staging` | TENANT_KV | GET | Staging layout | staging | ✅ Config cache |
| `tenant:{id}:design` | TENANT_KV | GET/PUT | Design tokens markdown | index, publish, submissions | ✅ Config — keep |
| `tenant:{id}:compiled` | TENANT_KV | GET/PUT/DEL | Compiled HTML cache | publish, publish-tenant | ✅ Cache — keep (TTL now 3600s) |
| `tenant:{id}:compiled:{tool}:{env}` | TENANT_KV | GET/PUT | Per-tool compiled cache | index | ✅ Cache — keep |
| `draft:{tenant}:{id}` | TENANT_KV | GET/PUT | Tenant draft layouts | builder | ✅ Tenant-editable config — keep (but could move to D1 for query) |
| `tenant:{slug}` | TENANT_KV | GET/PUT | Tenant config object | tenants, resolver | ✅ Config — keep |

### CATEGORY A — Template Registry → KV ✅

| Key Pattern | Namespace | Op | Purpose | Where | Classification |
|---|---|---|---|---|---|
| `template:{id}` | ARTIFACT_KV | GET/PUT | UI template definitions | templates | ✅ Read-heavy config — keep |

---

## Summary: Keys to Migrate

### Phase 1 (Immediate — High Impact)

| Migration | KV Savings | Risk | Effort |
|---|---|---|---|
| `telemetry:llm:{date}` → D1 `telemetry_daily` | ~80% of TELEMETRY_KV writes | Low — new table, backward-compat reads | 1 hr |
| `metrics:{tenant}:{tool}` → AnalyticsDO | Eliminates broken in-memory accumulator | Medium — requires DO binding | 2 hr |
| `score_trace:{tenant}:{lead}:{rubric}` → D1 `score_traces` | Low volume, better queryability | Low — additive migration | 30 min |

### Phase 2 (Next Sprint — Medium Impact)

| Migration | KV Savings | Priority |
|---|---|---|
| `alert:hot:{subId}` payloads → D1 `alert_details` (KV keeps index only) | Reduces TENANT_KV size | Medium |
| `nurture:{subId}` → D1 `form_submissions.nurture_flag` column | Eliminates KV write per cold lead | Low |
| `draft:{tenant}:{id}` → D1 `layout_drafts` | Better query, same write cost | Low |

### Phase 3 (Architecture — Long Term)

| Pattern | Implementation |
|---|---|
| Analytics DO for metrics | `TelemetryAggregator` DO with `state.storage` map, hourly D1 flush via cron |
| Write class enforcement | `writeCritical()`, `writeEvent()`, `writeSignal()`, `writeBinary()` helpers |
| Write budget monitor | Per-request counter in DO, alert on >5 writes/action |
