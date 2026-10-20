# System Design Document (SDD): EdgeGDE Press — Governed API Discovery & Connector Generation

**Document ID:** SDD-APA-001  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-10-10  \
**FRS Reference:** [FRS-APA-001](./FRS-APA-001-edgegde-press-governed-api-discovery-v1.md)

---

## 1. Scope

Internal architecture for FRS-APA-001. This document covers the dual-capture telemetry layer, the JSON-LD manifest generator, the governed transition bridge, and the multi-tier interface. It explains where they live and how data flows through them. The design sits on the existing FRS-007 layer (Observer Daemon, Transition Registry, Mission Queue, State Registry) and the T0 CDP sensory tier.

---

## 2. Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        Capture Plane (T0 CDP)                        │
│                                                                        │
│  CfT browser (port 9222)                                              │
│    │  CDP domains: Network, Performance, Page, Runtime               │
│    │  MutationObserver injected (aria-expanded/hidden/disabled/      │
│    │    data-react filter)                                             │
│    ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  DualCaptureSession (State Engine — NEW)                      │   │
│  │  - single clock, dual-domain event streams                    │   │
│  │  - PII hash-on-write (SHA-256 prefix 16)                      │   │
│  └────────────────────────┬─────────────────────────────────────┘   │
│                             │ correlated_timeline.jsonl               │
└─────────────────────────────┼────────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Interpretation Plane (NEW)                         │
│                                                                        │
│  ┌────────────────────────┐     ┌────────────────────────────────┐ │
│  │  CorrelationEngine      │────►│  ManifestGenerator              │ │
│  │  - timestamp alignment  │     │  - JSON-LD per domain           │ │
│  │  - window match ±500ms  │     │  - stackType inference          │ │
│  │  - frame/ctx/stack keys │     │  - preflightRules from telemetry│ │
│  └────────────────────────┘     └───────────────┬────────────────┘ │
│                                                  │ salestrekker.jsonld │
│                                                  ▼                     │
│                                       ┌──────────────────────────┐  │
│                                       │  PressBridge             │  │
│                                       │  - candidate_signature   │  │
│                                       │  - dual_gate_spec        │  │
│                                       │  - D1 UPSERT PENDING_…   │  │
│                                       └────────────┬─────────────┘  │
└────────────────────────────────────────────────────┼──────────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Governance Plane (FRS-007 — exists)               │
│                                                                        │
│  Transition Registry (D1) ──► approval ──► 3 shadow missions ──► ACTIVE│
│  Mission Queue (lease/heartbeat/SIGKILL recovery)                      │
│  State Registry (object_states, state_history, evidence L1)            │
└──────────────────────────────────────────────────────────────────────┘
                                                   ▲
┌──────────────────────────────────────────────────┼──────────────────┐
│                     Interface Plane (NEW)          │                  │
│  CLI (edgegde)  │  MCP (mcp_capture_workflow)  │  HTTP (/api/v1/press)│
└──────────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Owner |
|-----------|----------------|-------|
| `DualCaptureSession` | Enable CDP dual-domain capture, inject MutationObserver, hash PII, emit correlated JSONL | State Engine |
| `CorrelationEngine` | Align network + runtime events on one clock, match by window/frame/context/stack | State Engine |
| `ManifestGenerator` | Emit one JSON-LD manifest per domain. Infer `stackType`. Derive `preflightRules` | State Engine (`press/`) |
| `PressBridge` | Compute `candidate_signature`, generate `dual_gate_spec`, UPSERT into D1, enqueue shadow missions | State Engine (`press/`) |
| `TransitionRegistry` | Versioned transition rows, lifecycle, L1/L2 enforcement | Edge Runtime (exists) |
| `MissionQueue` | Lease-based execution, heartbeat, 401 retry via `SALSTREKKER_AUTH_REFRESH` | Edge Runtime (exists) |

---

## 3. Data Flow

### 3.1 Capture → Correlation

1. Operator starts `mcp_capture_workflow("salestrekker-income-save", 60000)`.
2. `DualCaptureSession` enables `Network`, `Performance`, `Page`, `Runtime` on the existing CDP connection and injects the MutationObserver.
3. Operator performs the workflow once.
4. Events stream into two buffers keyed by the same CDP wall clock (epoch-ms).
5. On stop, `CorrelationEngine` aligns each network request with runtime events in `[request_ts − 500ms, request_ts]`, matching on `frameId`, `executionContextId`, and initiator `stackTrace`.
6. Output: `correlated_timeline.jsonl` — each record `{timestamp, network:{...}, telemetry:{react_events, dom_mutations, js_stack, validation_flags}}`.

### 3.2 Correlation → Manifest

1. `ManifestGenerator` groups correlated records by target origin → one domain.
2. Each unique endpoint becomes a manifest `endpoints[]` entry with inferred `stackType` (route patterns + telemetry signatures) and `preflightRules` (hidden-state flags observed immediately before dispatch).
3. PII in payloads is hashed before manifest write (F01-R07).
4. Output: `salestrekker.jsonld` — `@context`, `@type: WebAPI`, `endpoints[]` with `context_type` per section.

### 3.3 Manifest → Transition

1. `PressBridge` reads the manifest endpoint.
2. Computes `selector_chain_hash` (canonical JSON of endpoint + payload shape) and `dual_gate_spec_hash` (canonical JSON of the generated gates).
3. Computes `candidate_signature = SHA256(object_type + source_state + target_state + selector_chain_hash + dual_gate_spec_hash)`.
4. Generates `dual_gate_spec`:
   - Gate 1 `resume_check`: fresh GET target object → if `current_state == target_state`, return `{idempotent: true, skipped: true}`.
   - Gate 2 `verify_check`: after dispatch, do a fresh GET. Confirm `PERSISTED`. Otherwise the result is FAILED with no commit.
5. UPSERTs into D1 `transition_registry` as `PENDING_APPROVAL`. Emits a Telegram approval prompt.
6. On approval: enqueues `shadow-<sig8>-{1..3}` via Mission Queue.
7. ACTIVE requires 3 consecutive shadow passes spanning ≥3 distinct `observation_diversity_hash` values.

### 3.4 Execution (all tiers)

```
CLI edgegde mission run ──┐
MCP tool call ────────────┼──► MissionQueue.enqueue ──► Performer.claim
HTTP POST /api/v1/press ──┘                            ├─ Gate 1 resume_check
                                                     ├─ dispatch (API replay, token from state object)
                                                     ├─ Gate 2 verify_check (fresh GET)
                                                     ├─ StateRegistry.commit_transition (L1 evidence)
                                                     └─ MissionQueue.complete (atomic)
```

---

## 4. Storage

### 4.1 D1: `domain_manifests` (NEW)

```sql
CREATE TABLE domain_manifests (
  domain TEXT PRIMARY KEY,
  payload TEXT CHECK(json_valid(payload)),
  updated_at INTEGER  -- unixepoch()*1000
);

CREATE VIRTUAL TABLE domain_manifests_fts USING fts5(
  domain, payload, content='domain_manifests', content_rowid='rowid'
);
-- triggers keep FTS in sync on INSERT/UPDATE/DELETE
```

Queries use native JSON operators:
```sql
SELECT domain, payload ->> '$.name' AS manifest_name
FROM domain_manifests
WHERE payload ->> '$.@type' = 'WebAPI';

SELECT m.domain, ep.value ->> '$.name' AS endpoint_name
FROM domain_manifests m, json_each(m.payload -> '$.endpoints') ep
WHERE ep.value ->> '$.stackType' = 'React';
```

### 4.2 D1: `transition_registry` (exists, migration 0027)

Unchanged schema. `PressBridge` is a new producer of `PENDING_APPROVAL` rows.

### 4.3 Local: `~/.edgegde/manifests.db` (optional mirror)

SQLite FTS5 mirror of `domain_manifests` for offline/low-latency reads via `edgegde sync`.

---

## 5. File Structure

```text
apps/state-engine/
  observer.py              # exists — DualCaptureSession hooks in here
  press/
    __init__.py
    capture.py             # DualCaptureSession + CorrelationEngine
    manifest.py            # ManifestGenerator (JSON-LD)
    bridge.py              # PressBridge (signature + dual_gate + D1 UPSERT)
    correlate.py           # timestamp alignment, window matching
    cli.py                 # edgegde CLI (click/typer)
  main.py                  # MCP: add mcp_capture_workflow

apps/edge-runtime/src/api/
  press.ts                 # HTTP /api/v1/press/* (thin proxy to Mission Queue)
  transitions.ts           # exists
  mission-queue.ts         # exists (add 401 → SALSTREKKER_AUTH_REFRESH retry)

migrations/
  0028_create_domain_manifests.sql
```

---

## 6. Key Algorithms

### 6.1 Correlation window matching

```python
def correlate(network_events, telemetry_events, window_ms=500):
    telemetry_sorted = sorted(telemetry_events, key=lambda e: e["timestamp"])
    for net in network_events:
        lo, hi = net["timestamp"] - window_ms, net["timestamp"]
        matches = [t for t in telemetry_sorted
                   if lo <= t["timestamp"] <= hi
                   and t["frameId"] == net["frameId"]
                   and t["executionContextId"] == net["executionContextId"]]
        yield CorrelatedRecord(
            timestamp=net["timestamp"],
            network=net,
            telemetry=TelemetryBundle(
                react_events=[m for m in matches if m["type"] == "perf"],
                dom_mutations=[m for m in matches if m["type"] == "mutation"],
                js_stack=net["initiator"]["stackTrace"],
                validation_flags=extract_flags(matches),
            ),
        )
```

### 6.2 Signature computation

```python
def canonical(obj):  # recursively sorted-key, fixed separators
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))

selector_chain_hash = sha256(canonical({
    "endpoint": ep["target"], "method": ep["httpMethod"], "payload": ep["payload"]
}))
dual_gate_spec_hash = sha256(canonical(dual_gate_spec))
candidate_signature = sha256(canonical({
    "object_type": object_type,
    "source_state": source_state,
    "target_state": target_state,
    "selector_chain_hash": selector_chain_hash,
    "dual_gate_spec_hash": dual_gate_spec_hash,
}))
# transition_name is NOT in the formula — renaming UPSERTs the same row
```

### 6.3 Diversity guard

```python
def verify_promotion_guard(candidate_id, db):
    last3 = last_consecutive_shadow_passes(candidate_id, limit=3)
    distinct = {r["observation_diversity_hash"] for r in last3}
    return len(last3) == 3 and len(distinct) >= 3
```

---

## 7. Failure Handling

| Failure | Behavior |
|---------|----------|
| CDP domain enable fails | Capture aborts with a typed error. No partial timeline |
| Correlation finds no matches | Endpoint is still emitted with empty `preflightRules`. Flagged `telemetry_unconfirmed` |
| Manifest generation PII leak | Write fails closed. Operator alerted. Artifact quarantined |
| Gate 2 verify_check unconfirmed | Mission FAILED, `verify_failed` stat, state NOT committed |
| 401 during dispatch | Enqueue `SALSTREKKER_AUTH_REFRESH`, lease-aware retry (attempts+1) |
| Shadow mission fails | Candidate stays `PENDING_APPROVAL`/`APPROVED_FOR_VALIDATION`. The consecutive-pass counter resets |

---

## 8. Testing Strategy

1. **Unit** (`tests/unit-*.test.ts`): correlation window logic, canonical hashing, signature determinism, diversity guard.
2. **D1 harness** (node:sqlite adapter): `domain_manifests` migration, FTS5 triggers, JSON operator queries.
3. **Integration**: dual-capture against a local fixture SPA (React) → manifest → bridge → shadow promotion in a fake queue.
4. **Live demo**: real Salestrekker capture → real manifest → real shadow missions (read-only until ACTIVE).

---

## 9. Migration Plan

1. Apply `0028_create_domain_manifests.sql` manually (D1 migrations are CI-only per AGENTS.md).
2. Deploy State Engine with `press/` module + `mcp_capture_workflow`.
3. Deploy Edge Runtime with `/api/v1/press/*` + 401 retry.
4. Run the Phase 0 PoC (Printing Press) in parallel to validate the data shape. Compare outputs.
5. Promote first Salestrekker transition through shadow missions to ACTIVE.

---

## 10. Non-Goals

- Multi-tenant runtime, session pooling, IP rotation.
- Cross-domain JSON-LD knowledge graph.
- Removing the 4-tier sensory array — DOM remains the fallback tier.
