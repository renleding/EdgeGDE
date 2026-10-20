# Functional Requirements Specification (FRS): EdgeGDE Press — Governed API Discovery & Connector Generation

**Document ID:** FRS-APA-001  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-10-10  \
**Source:** Salestrekker APA feasibility research. Warren directive: JSON-LD manifests, own the capability, governance non-negotiable

---

## 1. Objective

Provide a governed capability that turns observed browser traffic into verified, versioned, reusable automation connectors. It replaces brittle DOM automation with deterministic API replay. It preserves the FRS-007 governance chain: dual-gate, shadow promotion, L1 evidence, diversity guard.

EdgeGDE Press is **not** a third-party compiler. It is the native extraction layer. It turns the Observer Daemon's dual-capture (network plus runtime telemetry) into JSON-LD domain manifests and signed transition candidates.

---

## 2. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-10 | Initial specification |

---

## 3. Current Baseline

### 3.1 Observer Daemon (Phase 4 — exists)

`apps/state-engine/observer.py` captures read-only DOM inputs, network calls, and clicks into `evidence.db`. It records *that* something happened, but:

- No network-payload schema extraction. Endpoints and request shapes are not mined.
- No runtime telemetry capture. React state flags, validation gates, and hidden tokens are invisible.
- No correlation. Network and runtime events are not aligned on a unified timeline.
- No manifest generation. Observed traffic does not become a reusable connector.

### 3.2 Transition Registry (Phase 5 — exists)

`apps/edge-runtime/src/api/transitions.ts` stores versioned transition signatures in D1. Its lifecycle runs `PENDING_APPROVAL → APPROVED_FOR_VALIDATION → ACTIVE`. It accepts candidates but has no producer that generates them from observed traffic.

### 3.3 Salestrekker automation (exists)

The 4-tier sensory array (T0 CDP → T4 CUA) drives the DOM directly. It is brittle. Radix portal blocking, React synthetic-event fallback, and the false-positive "Client profile updated" toast all degrade reliability. There is no API-replay path.

**Gap:** The system can *observe* traffic and *store* transitions. It cannot *discover* API contracts, *unify* them with runtime telemetry, or *generate* governed connectors from them.

---

## 4. Requirements

### 4.1 FEATURE-01: Dual-Capture Telemetry Unification

**Priority:** P1  \
**Effort:** Medium (~1 week)

**User Story:** As an automation engineer, I can capture a single workflow once. I receive a unified, timestamp-aligned timeline. It shows each network request alongside the React/DOM runtime events that triggered it. I can then replay the request deterministically without touching the DOM.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | The capture session MUST enable CDP `Network`, `Performance`, `Page`, and `Runtime` domains on a single browser session sharing one wall clock | Must |
| F01-R02 | The session MUST inject a MutationObserver capturing `aria-expanded`, `hidden`, `disabled`, and `data-react` attribute changes on a configurable filter | Must |
| F01-R03 | Every network event (`requestWillBeSent`, `responseReceived`) and every runtime event (Performance metric, DOM mutation) MUST carry an epoch-ms timestamp from the same CDP clock | Must |
| F01-R04 | The correlation engine MUST align each network request with runtime events in the `[request_ts − 500ms, request_ts]` window. It matches by frame ID, execution context, and initiator stack | Must |
| F01-R05 | The correlated output MUST be a JSONL timeline. Each record carries `network` (method, url, request_payload, response_status, response_body) and `telemetry` (react_events, dom_mutations, js_stack, validation_flags) | Must |
| F01-R06 | Capture MUST be read-only with respect to the target application. It MUST NOT mutate application state | Must |
| F01-R07 | Capture MUST NOT persist raw PII from request/response bodies. It MUST store sensitive values as `value_hash` (SHA-256 prefix 16), consistent with the Observer Daemon PII rule | Must |
| F01-R08 | Capture MUST be exposed as an MCP tool `mcp_capture_workflow` with parameters `{workflow_name, duration_ms, capture_domains, mutation_observer_config}` | Should |

**Scenarios:**

#### Scenario: Capture Salestrekker income-section save
- **Given** a CfT browser session with CDP on port 9222 and an authenticated Salestrekker session
- **When** the operator starts `mcp_capture_workflow("salestrekker-income-save", 60000)` and performs Deal → Income section → Save once
- **Then** the engine emits `correlated_timeline.jsonl`. The POST to `/api/deals/{id}/income` is paired with the React `isDirty`/`touched` flag mutations and the CSRF token read that preceded it

#### Scenario: PII is not persisted
- **Given** a captured request body containing a plaintext SSN
- **When** the timeline is written
- **Then** the SSN appears only as a 16-char SHA-256 prefix hash. The check `raw_not_in_json.dumps(events)` holds

---

### 4.2 FEATURE-02: JSON-LD Domain Manifest Generation

**Priority:** P1  \
**Effort:** Medium (~1 week)

**User Story:** As the system, I turn a correlated timeline into a JSON-LD domain manifest. I emit one manifest per domain. It records every discovered endpoint, its payload schema, its frontend stack type, and the pre-flight rules the stack demands.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | The manifest generator MUST emit one JSON-LD document per domain (`@context`, `@type: WebAPI`, `name`, `url`, `endpoints[]`). JSON-LD is the mandated manifest format | Must |
| F02-R02 | Each endpoint entry MUST carry `name`, `target` (route), `httpMethod`, `stackType`, `payload` (inferred schema), and `preflightRules[]` (derived from telemetry) | Must |
| F02-R03 | `stackType` MUST be one of `React`, `Angular`, `Vue`, `WordPress`, `HTML`, or `Other`. The generator infers it from telemetry and route patterns | Must |
| F02-R04 | `preflightRules` MUST derive from telemetry-observed hidden state (e.g. `isDirty: true`, `touched: true`, `csrf_from_hook`, `FormGroup type conformity`) | Must |
| F02-R05 | A single domain manifest MUST support mixed frontend stacks. Different endpoints MAY carry different `stackType` values within one document | Must |
| F02-R06 | Manifests MUST be stored in a D1 `domain_manifests` table (`domain TEXT PRIMARY KEY, payload TEXT CHECK(json_valid(payload)), updated_at INTEGER`) | Must |
| F02-R07 | An FTS5 virtual table MUST mirror the manifest payloads for semantic search. Triggers keep it synchronized | Should |
| F02-R08 | Manifest queries MUST use D1/SQLite native JSON operators (`->>`, `json_each()`, `json_valid()`). No external parser is allowed | Must |

**Scenarios:**

#### Scenario: Generate Salestrekker manifest from correlated timeline
- **Given** a correlated timeline for `salestrekker.com` covering the income, assets, and liabilities sections
- **When** the manifest generator runs
- **Then** it produces a single JSON-LD document. Its `endpoints[]` contains `save-income-section` (`stackType: React`, `preflightRules: ["isDirty","touched"]`), `save-assets-section`, and `save-liabilities-section`. Each carries a distinct `context_type`

#### Scenario: Mixed-stack domain
- **Given** a government portal with a React dashboard, an Angular wizard, and a WordPress help section
- **When** the manifest generator runs
- **Then** the single document carries three endpoints. Their `stackType` values are `React`, `Angular`, and `WordPress` respectively. Each carries stack-appropriate `preflightRules`

---

### 4.3 FEATURE-03: Governed Transition Candidate Generation

**Priority:** P1  \
**Effort:** Medium (~1 week)

**User Story:** As the governance layer, I turn a JSON-LD manifest into signed, versioned transition candidates. They enter the FRS-007 promotion pipeline. The system never dispatches an unverified connector.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F03-R01 | For each manifest endpoint, the bridge MUST compute `candidate_signature = SHA256(object_type + source_state + target_state + selector_chain_hash + dual_gate_spec_hash)`. Sub-hashes run over recursively sorted-key canonical JSON | Must |
| F03-R02 | The bridge MUST generate a `dual_gate_spec` from the manifest's `preflightRules`. Gate 1 `resume_check` does a fresh read of the target object. If it is already in `target_state`, the bridge skips idempotently. Gate 2 `verify_check` does a fresh read after dispatch. An unconfirmed read yields FAILED with state NOT committed | Must |
| F03-R03 | The bridge MUST UPSERT candidates into the D1 `transition_registry` with status `PENDING_APPROVAL`. Rows are keyed by `transition_family_id` (immutable version rows, signature PK) | Must |
| F03-R04 | `verification_class` MUST be L1 or L2. L3 (cached DOM / no reload) MUST be rejected with HTTP 400 | Must |
| F03-R05 | On promotion, the bridge MUST enqueue 3 shadow missions (`shadow-<sig8>-{1..3}`) via the Mission Queue. ACTIVE requires 3 consecutive shadow passes | Must |
| F03-R06 | The promotion guard MUST require the last 3 consecutive shadow passes to span ≥3 distinct `observation_diversity_hash` values (`SHA256(object_type + transition_name + context_type)`) | Must |
| F03-R07 | A change to selectors, states, or the dual-gate spec MUST produce a new signature. That new signature creates a new version row. The prior version MUST be preserved | Must |

**Scenarios:**

#### Scenario: Candidate enters governance
- **Given** a Salestrekker manifest endpoint `save-income-section`
- **When** the bridge generates its candidate
- **Then** it UPSERTs a row with the computed `candidate_signature` into `transition_registry` as `PENDING_APPROVAL`. It also emits a Telegram approval prompt

#### Scenario: L3 evidence is rejected
- **Given** a candidate whose `dual_gate_spec` verification_class is L3 (cached DOM)
- **When** the bridge attempts promotion
- **Then** the registry rejects it with HTTP 400. The candidate remains `PENDING_APPROVAL`

#### Scenario: False-positive toast is caught
- **Given** a dispatched `save-income-section` where Salestrekker shows a false "Client profile updated" toast but the server state did not change
- **When** Gate 2 `verify_check` performs a fresh GET of the income section
- **Then** the read-back does not confirm `PERSISTED`. The mission is marked FAILED with `verify_failed`. No state is committed

---

### 4.4 FEATURE-04: Multi-Tier Interface (CLI, MCP, HTTP)

**Priority:** P2  \
**Effort:** Small (~3 days)

**User Story:** As an operator or agent, I can drive EdgeGDE Press through a token-efficient CLI, a native MCP tool, or an HTTP API. All three ride the same governed Mission Queue path. None permits unverified dispatch.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F04-R01 | A CLI `edgegde` MUST expose `domain list/show`, `transition list`, `capture start`, and `mission enqueue/run` subcommands | Must |
| F04-R02 | CLI output MUST be token-efficient (NDJSON/JSON by default, `--quiet` for one-line status) | Must |
| F04-R03 | Every CLI `mission run` MUST route through the Mission Queue and pass the same dual-gate as an MCP-initiated mission. The CLI MUST NOT bypass governance | Must |
| F04-R04 | Session tokens MUST come from state objects with TTL, not `.env` files. A 401 response MUST trigger `SALSTREKKER_AUTH_REFRESH` and a lease-aware retry | Must |
| F04-R05 | An HTTP API MUST expose the same operations under `/api/v1/press/*` | Should |
| F04-R06 | An optional local SQLite mirror (`edgegde sync` → `~/.edgegde/manifests.db`) MUST support offline/low-latency manifest reads | Should |

**Scenarios:**

#### Scenario: CLI mission is governed
- **Given** an operator runs `edgegde mission run --domain salestrekker.com --transition save-income-section --payload-file income.json --verify L1`
- **When** the CLI dispatches
- **Then** the mission is enqueued to the Mission Queue. It passes Gate 1 and Gate 2. It returns `{"status":"COMPLETED","evidence_id":"ev_...","state":"PERSISTED"}` — or FAILED with no commit

#### Scenario: Token refresh on 401
- **Given** a dispatched mission receives a 401 from Salestrekker
- **When** the Mission Queue handler processes the failure
- **Then** it enqueues `SALSTREKKER_AUTH_REFRESH`. It waits for a fresh token. It retries the original mission without operator intervention

---

## 5. Acceptance Criteria

1. One dual-capture of a Salestrekker section yields a correlated timeline with network plus telemetry aligned on one clock (F01).
2. The timeline generates a single JSON-LD manifest with correct `stackType` and `preflightRules` per endpoint (F02).
3. The manifest generates a signed transition candidate. It enters `PENDING_APPROVAL` and reaches ACTIVE only after 3 consecutive shadow passes across ≥3 diversity hashes (F03).
4. A false-positive toast on a dispatched mission is caught by Gate 2. Gate 2 commits no state (F03-R02).
5. The CLI, MCP, and HTTP tiers all route through the same governed Mission Queue with identical verification (F04).
6. No raw PII persists in any captured artifact (F01-R07).

---

## 6. Non-Goals

- Multi-tenant SaaS (session pooling, IP rotation, JWT/Redis rate limiting). This is a single-user context.
- Chrome extension distribution. Hermes orchestrates the user's own browser.
- Full JSON-LD `@context` entity-linking across domains. We use plain JSON-LD per domain. Cross-domain resolution is a future catalogue concern.
- Removing Playwright or the 4-tier sensory array. API replay is the primary path. DOM remains the fallback for non-replayable workflows (uploads, wizards, CAPTCHA).

---

## 7. Out of Scope (Phase 1)

- Native replacement of the Phase 0 Printing Press PoC. Phase 0 uses the external tool for discovery only. Phase 1 is this native capability.
- Cross-domain JSON-LD knowledge graph.