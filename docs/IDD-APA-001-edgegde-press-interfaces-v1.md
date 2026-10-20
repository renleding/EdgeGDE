# Intent Driven Design (IDD): EdgeGDE Press — Governed API Discovery & Connector Generation

**Document ID:** IDD-APA-001  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-10-10  \
**FRS Reference:** [FRS-APA-001](./FRS-APA-001-edgegde-press-governed-api-discovery-v1.md)  \
**SDD Reference:** [SDD-APA-001](./SDD-APA-001-edgegde-press-architecture-v1.md)

---

## 1. Purpose

IDD defines the *intent* behind each interface in SDD-APA-001. It describes what each component is designed to achieve, the contracts it fulfills, and the invariants it maintains. Implementers satisfy these intents. Consumers rely on them.

---

## 2. Interface Contracts

### 2.1 `mcp_capture_workflow(params) → CorrelatedTimeline`

**Intent:** Capture a single user workflow once. Produce a unified, timestamp-aligned timeline. Every network request is paired with the React/DOM runtime events that triggered it. This enables deterministic API replay without browser DOM interaction.

**Contract:**

- **Input:** `{workflow_name: str, duration_ms: int, capture_domains: list[str], mutation_observer_config: dict}`
- **Preconditions:** Active CfT CDP session. Authenticated target application state.
- **Behavior:**
  - Enables exactly the requested CDP domains (Network, Performance, Page, Runtime) on the shared connection.
  - Injects a MutationObserver with the provided filter (`aria-expanded`, `hidden`, `disabled`, `data-react` by default).
  - Records all events using the CDP wall clock (epoch-ms) — no mixing of `Date.now()` or Python timestamps.
  - On stop (duration elapsed or manual signal): it runs `CorrelationEngine` to align each network request with runtime events in the `[request_ts − 500ms, request_ts]` window. It matches on `frameId`, `executionContextId`, and initiator `stackTrace`.
  - PII in request/response bodies is hashed (SHA-256 prefix 16) before write. Raw values never persist.
- **Output:** `CorrelatedTimeline` — NDJSON stream where each record has:
  ```json
  {
    "timestamp": 1791613032000,
    "network": {"method": "POST", "url": "/api/deals/123/income", "request_payload": {...}, "response_status": 200, "response_body": {...}},
    "telemetry": {"react_events": [...], "dom_mutations": [...], "js_stack": [...], "validation_flags": {"isDirty": true, "touched": true, "csrf_from_hook": true}}
  }
  ```
- **Invariants:**
  - I1: Single clock — all timestamps from CDP wall clock, no external clocks.
  - I2: Read-only — capture never mutates target application state.
  - I3: PII hashed. The check `raw_not_in_json.dumps(events)` holds for all persisted records.
  - I4: Correlated. Every network event has an associated telemetry bundle. The bundle may be empty. It is flagged if so.

---

### 2.2 `ManifestGenerator.generate(correlated_timeline) → JSON-LD Manifest`

**Intent:** Turn a correlated timeline into a single, queryable JSON-LD domain manifest. It records every discovered endpoint, its payload schema, its frontend stack type, and the pre-flight rules the stack demands. The system can then replay requests without guessing.

**Contract:**

- **Input:** `CorrelatedTimeline` (NDJSON stream or file path).
- **Behavior:**
  - Groups records by origin → one manifest per domain.
  - For each unique endpoint (method + target route):
    - Infers `stackType` from telemetry signatures and route patterns (`React`/`Angular`/`Vue`/`WordPress`/`HTML`/`Other`).
    - Derives `preflightRules` from `validation_flags` observed immediately before dispatch (hidden boolean flags, CSRF token sources, FormGroup type constraints, nonce headers).
    - Infers a minimal JSON Schema for `request_payload` and `response_body`.
    - Assigns a `context_type` (section/workflow identifier) for diversity hashing.
  - PII is already hashed in the timeline. The manifest inherits the hashes.
  - Emits one JSON-LD document:
    ```json
    {
      "@context": "https://schema.org",
      "@type": "WebAPI",
      "name": "salestrekker-manifest",
      "url": "https://salestrekker.com",
      "endpoints": [
        {
          "name": "save-income-section",
          "target": "/api/deals/{id}/income",
          "httpMethod": "POST",
          "stackType": "React",
          "context_type": "income",
          "payload": {...},
          "preflightRules": ["isDirty: true", "touched: true", "csrf_from_hook"]
        }
      ]
    }
    ```
- **Output:** JSON-LD document (valid JSON, queryable with SQLite `->>`, `json_each()`).
- **Side-effect:** UPSERT into D1 `domain_manifests` table (`domain`, `payload`, `updated_at`).
- **Invariants:**
  - I5: One manifest per domain — mixed stacks live in one document via per-endpoint `stackType`.
  - I6: Every endpoint carries `stackType` and `preflightRules` — no silent defaults.
  - I7: `context_type` is present on every endpoint — required for diversity hash.
  - I8: JSON-LD is valid JSON — `json_valid(payload)` in D1 passes.

---

### 2.3 `PressBridge.promote(manifest, endpoint_name) → TransitionCandidate`

**Intent:** Turn a manifest endpoint into a signed, versioned transition candidate. It enters the FRS-007 governance pipeline. This ensures no unverified connector can ever be dispatched.

**Contract:**

- **Input:** `{domain: str, endpoint_name: str}` (looks up manifest from D1).
- **Behavior:**
  - Reads the manifest endpoint.
  - Computes `selector_chain_hash = SHA256(canonical({endpoint, method, payload}))`.
  - Generates `dual_gate_spec` from `preflightRules`:
    - Gate 1 `resume_check`: fresh GET target object → if `current_state == target_state`, return `{idempotent: true, skipped: true}` (handler never runs).
    - Gate 2 `verify_check`: after dispatch, do a fresh GET. Confirm `PERSISTED`. Unconfirmed means FAILED with state NOT committed.
  - Computes `dual_gate_spec_hash = SHA256(canonical(dual_gate_spec))`.
  - Computes `candidate_signature = SHA256(canonical({object_type, source_state, target_state, selector_chain_hash, dual_gate_spec_hash}))`.
    - **`transition_name` is NOT in the formula** — renaming alone UPSERTs the same row.
  - UPSERTs into D1 `transition_registry` with status `PENDING_APPROVAL`, keyed by `transition_family_id` (signature PK).
  - `verification_class` MUST be L1 or L2. L3 is rejected with HTTP 400.
  - Emits a Telegram approval prompt (cron `transition-approval-watchdog`).
- **Output:** `TransitionCandidate` — `{candidate_signature, transition_family_id, status: "PENDING_APPROVAL", manifest_endpoint: str}`.
- **Invariants:**
  - I9: Signature is deterministic — same manifest + same dual-gate = same signature.
  - I10: L3 verification_class is rejected — no cached-DOM verification allowed.
  - I11: Versioning. A change to selectors, states, or dual-gate spec produces a new signature. That creates a new version row. The prior version is preserved.
  - I12: `transition_name` not in signature — renaming does not create a new version.

---

### 2.4 `TransitionRegistry.promote_to_validation(candidate_signature) → ShadowMissions`

**Intent:** Upon human approval, enqueue the mandatory shadow missions that prove the connector generalizes across distinct contexts before it becomes ACTIVE.

**Contract:**

- **Input:** `candidate_signature` (must be `PENDING_APPROVAL`).
- **Behavior:**
  - Transitions status to `APPROVED_FOR_VALIDATION`.
  - Enqueues exactly 3 shadow missions via Mission Queue: `shadow-<sig8>-1`, `shadow-<sig8>-2`, `shadow-<sig8>-3`.
  - Each shadow mission carries `verification_class: L1` and the full `dual_gate_spec`.
  - Shadow missions target distinct `context_type` values (Income, Assets, Liabilities). This satisfies the diversity guard.
- **Output:** 3 Mission Queue items with `mission_type: "shadow-validation"`.
- **Invariants:**
  - I13: Exactly 3 shadow missions per promotion.
  - I14: Shadow missions MUST target ≥3 distinct `observation_diversity_hash` values (`SHA256(object_type + transition_name + context_type)`).
  - I15: Promotion to ACTIVE requires 3 CONSECUTIVE shadow passes (scattered passes reset the counter).

---

### 2.5 `MissionQueue.execute(mission) → MissionResult`

**Intent:** Execute a mission (shadow or production) through the governed lease-based queue. It applies dual-gate verification. L1 evidence is the only path to state commit.

**Contract:**

- **Input:** Mission payload with `{transition_name, payload, verification_class, dual_gate_spec}`.
- **Behavior:**
  1. `Performer.claim()` — atomic lease claim (CLOCK RULE: `unixepoch()*1000`).
  2. Gate 1 `resume_check` — fresh read of target object. If `target_state` reached → `{idempotent: true, skipped: true}`, handler never runs.
  3. Dispatch: API replay via MCP/HTTP with a fresh session token from a state object (TTL tracked). On 401, enqueue `SALSTREKKER_AUTH_REFRESH` and retry with a new token.
  4. Gate 2 `verify_check` — fresh GET target object. Confirm `PERSISTED`. Unconfirmed → FAILED, `verify_failed` stat, no state commit.
  5. `StateRegistry.commit_transition()`. L1 evidence is required (a fresh API GET row in the `evidence` table with `evidence_strength: L1`).
  6. `MissionQueue.complete()`. This is atomic (it validates the holder and the lease expiry in one statement).
- **Output:** `MissionResult` — `{status: COMPLETED|FAILED|DEAD, evidence_id?, state?}`.
- **Invariants:**
  - I16: Gate 1 runs BEFORE the handler. Gate 2 runs AFTER. Both are fresh reads (not cached).
  - I17: L1 evidence is mandatory — L3 executor return value is never sufficient.
  - I18: 401 triggers auth refresh and retry. Lease expiry auto-releases to QUEUED.
  - I19: Shadow mission results are only accepted while `APPROVED_FOR_VALIDATION`. ACTIVE requires 3 consecutive passes plus the diversity guard.

---

### 2.6 `CLI.edgegde(...)` / `MCP.mcp_press_...` / `HTTP.POST /api/v1/press`

**Intent:** Provide three interchangeable interfaces over the same governed Mission Queue path — no tier bypasses verification.

**Contract:**

- All three tiers accept the same core parameters: `{domain, transition, payload, verify_class}`.
- All three enqueue to the same Mission Queue with the same `dual_gate_spec` derived from the manifest.
- All three return the same `MissionResult` shape. The CLI uses token-efficient NDJSON. MCP and HTTP use structured JSON.
- Session tokens are sourced from state objects (TTL), not `.env` files.
- **No tier may bypass the dual-gate or the State Registry commit.**
- **Invariants:**
  - I20: `edgegde mission run --verify L1` is equivalent to an MCP tool call. It is equivalent to an HTTP POST. Governance is identical.
  - I21: The local SQLite mirror (`edgegde sync`) is read-only for manifests. Mutations always hit the Mission Queue.

---

## 3. Cross-Cutting Invariants

| Invariant | Description |
|-----------|-------------|
| **IV-1** | Single clock: all timestamps and lease decisions use `unixepoch()*1000` from D1/CDP — never `Date.now()` or Python `time.time()`. |
| **IV-2** | PII hashing. Every persisted value from request/response bodies is stored as SHA-256 prefix 16. Raw values are never written. |
| **IV-3** | Governance chain: Capture → Manifest → Signature → Dual-Gate → Shadow → ACTIVE → Dispatch. No shortcut. |
| **IV-4** | Evidence-first: a state transition is committed ONLY when an L1 evidence row exists in the `evidence` table. |
| **IV-5** | Diversity proof: ACTIVE requires ≥3 distinct `context_type` in consecutive shadow passes — not just entity count. |
| **IV-6** | Versioning integrity. Signatures are content-addressed. Renaming does not version. Content change does. |
| **IV-7** | Fallback preserved. API replay is primary. The 4-tier sensory array (T0–T4) remains for non-replayable workflows. |

---

## 4. Anti-Patterns (What These Interfaces Prevent)

| Anti-Pattern | Prevented By |
|--------------|--------------|
| "Capture once, replay forever" without verification | Dual-gate + shadow promotion |
| "The executor returned 200, so it worked" | L1 evidence requirement (fresh GET) |
| "We updated the selector, same transition" | Content-addressed signature (new version) |
| "Run 100 shadow passes on one deal, call it ACTIVE" | Diversity guard (distinct `context_type`) |
| "Store API keys in `.env` for the CLI" | State object with TTL + 401 retry |
| "CLI is faster, skip the queue" | All tiers route through Mission Queue |

---

## 5. Evolution Guarantees

- **Manifest format:** JSON-LD is mandated. Future cross-domain `@context` linking is additive.
- **Signature formula:** Stable. New fields added to the canonical object must be included in the hash.
- **Dual-gate spec:** Extensible (add `pre_check`, `post_check` without breaking existing verifiers).
- **CLI/MCP/HTTP:** Thin proxies. Governance logic lives in the Mission Queue and State Registry, not in the interfaces.