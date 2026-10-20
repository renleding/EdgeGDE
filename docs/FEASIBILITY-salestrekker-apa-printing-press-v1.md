# Feasibility Report: Printing Press + Telemetry + MCP Architecture for Salestrekker APA

**Date:** 2026-10-10  
**Context:** Deep research from Gemini session on Printing Press (printingpress.dev), HAR capture, browser telemetry, and unified agentic automation architecture.  
**Scope:** Evaluate viability for Salestrekker automation within EdgeGDE's FRS-007 APA architecture.  
**Mode:** Analysis only — no implementation.

---

## Executive Summary

The Gemini research proposes a three-layer architecture:

```
[Browser Telemetry + HAR Capture] → [Printing Press (Go CLI + MCP + SQLite)] → [Agent (Hermes) via MCP]
```

**Verdict:** The architecture is **technically viable** for Salestrekker APA, but **requires significant adaptation** to fit EdgeGDE's governed architecture (FRS-007). The core gap: Printing Press generates *unverified* connectors; EdgeGDE demands *L1-verified, versioned, shadow-promoted* transitions with dual-gate enforcement. The report maps the research to FRS-007 primitives and identifies the integration work required.

---

## 1. Architecture Mapping: Research → FRS-007

| Research Layer | FRS-007 Equivalent | Status |
|---|---|---|
| HAR capture + live browser sniffing | **Observer Daemon** (Phase 4) — read-only perception | ✅ Exists, but DOM-coupled, not API-coupled |
| Printing Press schema extraction | **TaskMiner** (Phase 4) — `fill_<section>` candidates | ⚠️ Exists for DOM; no API payload mining |
| Printing Press CLI/MCP generation | **Transition Registry** (Phase 5) — versioned connectors | ❌ Missing: no signature versioning, no dual-gate, no shadow promotion |
| Skill definition (prompt wiring) | **Aegis skill + verification rules** | ⚠️ Exists but manual; needs auto-generation from telemetry |
| Session token harvesting | **Auth workflow in transition spec** | ⚠️ Partial (salestrekker-hybrid-login rules exist) |
| Local SQLite + FTS5 | **State Registry** (`object_states` + `state_history`) | ⚠️ Different schema; FRS-007 uses append-only audit |

**Key Insight:** FRS-007 already has the *governance skeleton* (State Registry, Transition Registry, Mission Queue, Observer, dual-gate, shadow promotion). The research's "Printing Press" maps to **TaskMiner → Transition Registry promotion pipeline**, but lacks the **verification contract** that makes FRS-007 production-grade.

---

## 2. Salestrekker-Specific Viability Assessment

### 2.1 Known Salestrekker Constraints (from `salestrekker-deep-automation` skill)

| Constraint | Impact on Research Architecture |
|---|---|
| React 18 SPA with Radix portal blocking | HAR capture works; telemetry needed for portal state |
| React props fallback (synthetic events) | Printing Press payload replay may miss client-side validation flags |
| False-positive "Client profile updated" toast | Dual-gate verification (Gate 2 read-back) **essential** — L3 toast ≠ L1 commit |
| 4-tier sensory array (T0–T3) | Research's HAR+telemetry = T1+T2 equivalent; T0 CDP still needed for auth |
| Virtual key state `'paired'` set by telemetry ingest | Network-level connector must replicate telemetry POST exactly |

### 2.2 Test Use Case: "Create Deal → Populate Income Section → Save"

**Viable path:**
1. **Telemetry capture** (manual, one-time): Performance trace + HAR of successful income-section save
2. **Printing Press ingestion**: HAR → Go CLI + MCP server with SQLite schema for deal/income endpoints
3. **FRS-007 integration**:
   - Map Printing Press endpoints → `transition_family` signatures (SHA256 of object_type+states+selectors+dual_gate_spec)
   - Define `dual_gate_spec`: Gate 1 = `resume_check` (deal already at INCOME_DRAFT?), Gate 2 = `verify_check` (fresh API GET deal income section → `PERSISTED`)
   - Enqueue shadow missions (`shadow-<sig8>-{1..3}`) with `verification_class: L1`
   - Promote to ACTIVE only after 3 consecutive shadow passes across ≥3 diversity hashes

**Effort estimate:** 2–3 engineering weeks (primarily FRS-007 wiring, not Printing Press setup).

---

## 3. Required Improvements for EdgeGDE Integration

### 3.1 Printing Press → FRS-007 Transition Registry Bridge (Critical)

**Current gap:** Printing Press outputs a Go CLI + MCP server + skill file. FRS-007 expects a **signed transition signature** with:
- `candidate_signature = SHA256(object_type + source_state + target_state + selector_chain_hash + dual_gate_spec_hash)`
- `transition_family_id` grouping immutable versions
- Lifecycle: `PENDING_APPROVAL → APPROVED_FOR_VALIDATION (3 shadow missions) → ACTIVE | REJECTED`

**Required bridge component** (`apps/state-engine/printing_press_bridge.py`):
```python
# Pseudo-spec
def import_printing_press_manifest(pp_mcp_config, har_file, telemetry_rules):
    # 1. Query Printing Press MCP for discovered endpoints + payload schemas
    # 2. Map each endpoint to FRS-007 transition candidates
    # 3. Generate dual_gate_spec from telemetry_rules (React state prerequisites)
    # 4. Compute candidate_signature (selector_chain_hash = hash of API endpoint+payload shape)
    # 5. UPSERT into D1 transition_registry with status=PENDING_APPROVAL
    # 6. Emit Telegram approval prompt (transition-approval-watchdog)
    # 7. On approval: enqueue 3 shadow missions via mission-queue
```

### 3.2 Dual-Gate Enforcement for API Connectors (Critical)

Research architecture assumes "payload replay works if token is fresh." **Salestrekker disproves this** — the false-positive toast means L3 (executor return) ≠ L1 (verified state).

**Must implement for every Printing Press connector:**
- `resume_check`: Before payload dispatch, GET the target object (deal/section). If already in `target_state`, return `{idempotent: true, skipped: true}` — **handler never runs**.
- `verify_check`: After dispatch, fresh GET (not cached). Confirm `current_state == target_state`. If not → `FAILED`, `verify_failed` stat, **no state commit**.

This is already in `Performer.work()` (FRS-007 Phase 3 P3). The bridge must generate these check functions from the Printing Press endpoint + telemetry rules.

### 3.3 Session Token Lifecycle (High)

Research proposes: "lightweight headless login → harvest token → feed to CLI."

**EdgeGDE integration:**
- Token acquisition = separate **transition** (`SALSTREKKER_AUTH_REFRESH`)
- Token stored in `object_states` with TTL, not `.env` file
- On 401 from any connector: auto-enqueue `SALSTREKKER_AUTH_REFRESH`, then retry original mission (lease-aware)
- Uses existing `salestrekker-hybrid-login` rules (rules 15–16: 2FA completion doesn't consume attempt)

### 3.4 Diversity Hash & Shadow Promotion (High)

Research has no equivalent. FRS-007 requires:
- `observation_diversity_hash = SHA256(object_type + transition_name + context_type)`
- `context_type` = section (Income/Asset/Liability independent even in same deal)
- Promotion guard: last 3 consecutive shadow passes must span ≥3 distinct diversity hashes

**For Salestrekker:** Must define `context_type` per section (Income, Assets, Liabilities, Expenses, Dependents) so shadow runs prove generalization, not entity overfitting.

### 3.5 Skill Definition Auto-Generation (Medium)

Research: telemetry rules → manual skill file editing.  
**EdgeGDE:** skill file = Aegis-verifiable contract. Auto-generate from telemetry + Printing Press manifest:
```markdown
# Generated skill fragment (salestrekker-income-section)
## Pre-flight rules (from telemetry)
- Before `create-lead`: ensure `session_token` fresh (check `object_states[auth].ttl > now`)
- Payload must include `isDirty: true`, `touched: true` (React synthetic event flags from telemetry)
- `verify_check`: GET `/api/deals/{id}/income` → confirm `status: "PERSISTED"`
```

### 3.6 Multi-Domain MCP Routing (Low, future)

Research: separate MCP server per domain.  
**EdgeGDE:** Already uses multi-MCP mounting (`mempalace-ladybug-projection`, `state-engine`, future `salestrekker-mcp`). Add `salestrekker-mcp` to `~/.hermes/config.yaml` plugins. No architecture change.

---

## 4. Implementation Roadmap (Phased)

### Phase 0: Proof of Concept (1 week)
- [ ] Capture HAR + Performance trace for **one** Salestrekker workflow (Deal → Income section save)
- [ ] Run Printing Press locally on HAR → generate `-pp-cli` + `-pp-mcp` + skill
- [ ] Verify MCP tools work against live Salestrekker with fresh token
- [ ] Document exact payload shape, React state flags, token headers

### Phase 1: FRS-007 Bridge (2 weeks)
- [ ] Implement `printing_press_bridge.py` (import manifest → transition candidates)
- [ ] Generate `dual_gate_spec` from telemetry rules
- [ ] Wire into D1 transition registry (`/api/v1/transitions`)
- [ ] Run 3 shadow missions via mission-queue; verify promotion to ACTIVE

### Phase 2: Token Lifecycle & Recovery (1 week)
- [ ] Add `SALSTREKKER_AUTH_REFRESH` transition
- [ ] Integrate with mission-queue 401 handling (retry after auth refresh)
- [ ] Test SIGKILL mid-execution → lease expiry → re-claim → idempotent resume

### Phase 3: Generalization (ongoing)
- [ ] Add remaining Salestrekker sections (Assets, Liabilities, etc.) as separate transitions with distinct `context_type`
- [ ] Auto-generate skill definitions from bridge output
- [ ] Integrate with kanban: each transition promotion = card transition

---

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Printing Press misses React client-side validation flags | High | Connector fails at Gate 2 | Mandatory telemetry capture per workflow; encode flags in `dual_gate_spec` |
| Session tokens expire mid-mission (401) | Medium | Mission fails, lease expires | `SALSTREKKER_AUTH_REFRESH` transition + mission-queue retry logic |
| Salestrekker API changes break connector | Medium | Silent data corruption | Shadow promotion diversity guard catches regression; `verification_class: L1` required |
| Printing Press upstream changes break bridge | Low | Bridge maintenance burden | Pin Printing Press version; bridge only consumes MCP tool output, not internals |
| HAR capture doesn't cover async React state | Medium | Incomplete connector | Combine HAR + Performance Trace (research recommendation) as standard capture SOP |

---

## 6. Test Use Case Confirmation

**Use Case:** `salestrekker create-deal --populate-income --from-crm {crm_id}` executed via Hermes APA mission.

**Success Criteria:**
1. Mission enqueued via `/api/v1/mission-queue/enqueue` with `mission_type: "salestrekker-income-populate"`
2. Performer claims, heartbeat extends lease during execution
3. Gate 1 (`resume_check`): GET deal → if `INCOME_DRAFT`, skip with `idempotent: true`
4. Printing Press MCP tool called with CRM data + fresh token + React state flags
5. Gate 2 (`verify_check`): Fresh GET deal income → `PERSISTED` with correct values
6. State committed to `object_states` (L1 evidence row in `evidence` table)
7. Mission `COMPLETED`; lease released; `state_history` appended
8. After 10+ runs @ 95%+ success + 3 consecutive shadow passes across 3+ sections → `promote_baseline()` → ACTIVE transition

**Verdict:** **VIABLE**. All primitives exist in FRS-007. The bridge work is engineering, not research.

---

## 7. Recommendation

**Proceed with Phase 0 PoC.** The architecture is sound and aligns with FRS-007's governed automation philosophy. The research's "ultimate combination" (HAR + telemetry + Printing Press) maps cleanly to:

```
Observer Daemon (perception) 
    → Printing Press Bridge (schema extraction + signature generation) 
    → Transition Registry (versioned connectors + dual-gate + shadow promotion) 
    → Mission Queue (lease-based execution + L1 verification)
```

**Do not adopt Printing Press as-is.** Adopt its *output* (endpoint schemas, payload shapes, MCP server) as input to the FRS-007 promotion pipeline. The governance layer (dual-gate, shadow promotion, diversity guard, L1 evidence) is non-negotiable for Salestrekker — the false-positive toast bug alone justifies it.

**Next action (if approved):** Schedule Phase 0 PoC in agent-4 worktree (`work/salestrekker-apa-poc`).

---

## 8. Supplement: JSON-LD, MCP Proxy, Streamable HTTP & Cloudflare Innovations

*Added 2026-10-10 after re-review of the full research session. The original report
covered the HAR + telemetry + Printing Press core; this supplement covers the
remaining topics the research raised and their fit with EdgeGDE.*

### 8.1 JSON-LD Domain Execution Manifests

**Research proposal:** Store each domain's automation profile (endpoints, payload
schemas, stack-specific pre-flight rules) as a JSON-LD document in a **single
master SQLite database** (`manifests` table: `id | domain | payload`), queried
with SQLite's native JSON operators (`->>`, `json_each()`, `json_valid()`), with
FTS5 for semantic search. At scale: 50 processes/domain ≈ 15–50 KB per manifest
(3–8 KB gzipped); 10,000 domains ≈ 2.5 GB.

**EdgeGDE fit: STRONG.**
- EdgeGDE already runs on **Cloudflare D1** (SQLite-compatible). D1 supports the
  identical JSON operators natively — no migration needed.
- D1 free tier = 5 GB; the research's 2.5 GB/10k-domain estimate fits free.
- EdgeGDE's transition registry (`0027_create_transition_registry.sql`) already
  stores structured execution profiles in D1. JSON-LD manifests are a **schema
  evolution**, not a new system.

**Verdict:** Adopt the *single-master-DB* pattern. Use plain JSON (not full
JSON-LD) for the single-domain Salestrekker case — the research itself concludes
"For Local/Solo Pods: Stick to YAML or standard JSON. JSON-LD is like using an
enterprise semantic graph database to store a shopping list." JSON-LD's `@context`
entity-linking only pays off at multi-domain catalogue scale (future SaaS).

**Recommended schema (D1):**
```sql
CREATE TABLE domain_manifests (
  domain TEXT PRIMARY KEY,
  payload TEXT CHECK(json_valid(payload)),
  updated_at INTEGER  -- unixepoch()*1000
);
-- FTS5 mirror via triggers for semantic search
```

### 8.2 MCP Proxy Gateway

**Research proposal:** One MCP Proxy between agent and N domain servers.
Northbound: presents as a single MCP server (`tools/list` aggregates all
domains). Southbound: routes tool calls by context (e.g.
`execute_domain_action(domain="salestrekker.com", ...)` → looks up manifest →
dispatches). Handles transport abstraction + session injection.

**EdgeGDE fit: STRONG — and currently missing.**
- Hermes currently mounts each MCP server **separately** in `~/.hermes/config.yaml`
  (`mcp.servers`: custom-tools, paper-search, tavily, mempalace, apiclaw). Each is
  a discrete connection; the agent must know which server owns which tool.
- A gateway would unify these behind one endpoint with **dynamic tool discovery**
  — the agent calls `execute_domain_action(domain, action, payload)` and the
  proxy routes it.

**Verdict:** Valuable, but **defer**. Current 5 servers are manageable manually.
The proxy becomes necessary when domain count grows (Salestrekker + government
portals + others). When built, it should be an **EdgeGDE Cloudflare Worker**
(see 8.4) — not a separate daemon.

### 8.3 Streamable HTTP Transport

**Research proposal:** MCP's modern transport (spec 2025-03-26, **supersedes
SSE**). Single `/mcp` endpoint; HTTP POST/GET with optional SSE for server
messages. Enables progress notifications, resumability, cancellability, standard
CORS/auth. TypeScript SDK 1.10.0+ (April 2025) supports it.

**EdgeGDE fit: MODERATE — future-proofing.**
- EdgeGDE's MCP servers are **local stdio** (mempalace, state-engine) or **HTTP**
  (tavily URL). None are remote SSE.
- If any MCP server becomes remote (e.g. the future domain-proxy gateway),
  Streamable HTTP is the correct transport — **not SSE** (deprecated).
- Progress notifications are directly useful for long-running APA missions
  (the mission-queue heartbeat is the current equivalent; Streamable HTTP would
  standardize it).

**Verdict:** Note as a **standards requirement** for any future remote MCP
endpoint. No action now.

### 8.4 Cloudflare Stack Alignment

**Research's "ultimate backend":** Workers (edge compute/proxy) + D1 (JSON-LD
storage) + KV (edge cache) + R2 (heavy assets) + Queues (async telemetry).

**EdgeGDE fit: EXACT — this IS EdgeGDE's stack.**
- AGENTS.md architecture contract: "Hono + TypeScript + D1 + KV + R2 + Durable
  Objects" on Cloudflare Workers.
- The research independently arrived at EdgeGDE's existing architecture for the
  multi-tenant SaaS evolution. This is **strong external validation** of the
  EdgeGDE design.

**Verdict:** No new infrastructure. The manifest registry, future MCP proxy, and
telemetry ingestion all land on EdgeGDE's existing Workers/D1/KV/R2/Queues.

### 8.5 Thin-Client Execution Model (Salestrekker-relevant)

**Research proposal:** Execution happens **on the user's own device** (browser
extension/bookmarklet/userscript), fetching manifests from cloud. PII never
leaves the device; requests fire from the user's residential IP → no WAF blocks.

**EdgeGDE fit: ALREADY THE PATTERN.**
- Salestrekker APA runs in **Warren's own Chrome** via the 4-tier sensory array
  (T0 CDP → T3 Qwen VL). Execution is client-side by design; the gateway
  (launchd `ai.hermes.gateway`) orchestrates but does not execute remotely.
- The "bookmarklet/userscript without extension" variants map to the existing
  T2/T3 fallbacks (CLI-driven CDP, vision model).

**Verdict:** No change. Salestrekker automation already satisfies the
thin-client principle.

### 8.6 Bitwarden Secrets Injection

**Research proposal:** PII/credential fields pulled just-in-time from Bitwarden
(secret values in volatile runtime memory, zero persistence).

**EdgeGDE fit: PARTIAL.**
- EdgeGDE already uses Bitwarden Secrets Manager for API keys (APILayer, etc.).
- For Salestrekker, credentials are in the browser session (cookies/OAuth), not
  a vault. Bitwarden injection is relevant only if APA extends to **government
  portals** with per-user PII fields.

**Verdict:** Reuse existing Bitwarden integration when portal automation is added.

### 8.7 What Does NOT Apply

| Research topic | Why it doesn't apply to EdgeGDE/Salestrekker |
|---|---|
| Session pooling + IP rotation | Multi-tenant SaaS concern; Warren automates his own account from his own IP |
| 1000-concurrent-process sizing (16 vCPU/32 GB) | Single-user workload; existing Mac mini handles it |
| Multi-tenant JWT/Redis rate limiting | No external customers |
| Chrome extension distribution | Hermes orchestrates the user's own browser; no extension needed |
| SaaS catalogue crowdsourcing (extension → cloud queue) | Out of scope; single-user automation |

### 8.8 Consolidated Verdict

The research's innovations are **architecturally aligned** with EdgeGDE — the
multi-tenant evolution it describes is the stack EdgeGDE already runs on. For the
Salestrekker APA use case, the actionable items are:

1. **Adopt** single-master-DB manifest pattern (plain JSON on D1, not JSON-LD)
2. **Note** Streamable HTTP as the transport standard for any future remote MCP
3. **Defer** MCP proxy gateway until domain count > 5
4. **Reject** SaaS-scale concerns (session pooling, IP rotation, multi-tenancy) —
   single-user context
5. **Validate** thin-client execution — already the Salestrekker pattern

The feasibility conclusion is unchanged: the Printing Press bridge into FRS-007's
governed pipeline (Section 3) remains the only critical-path work.