# Functional Requirements Specification (FRS): Task-Aware Model Routing Classifier

**Document ID:** FRS-009  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-08-18  \
**Source:** Warren direction 2026-08-18 — "Are we able to route by task?" → "Write a frs for option 2. Gogo". Option 2 = a lightweight auto-classifier shim in front of the LiteLLM gateway (`:4000`) that inspects a caller-provided `task` field and forwards to the correct model alias per task type.

---

## 1. Objective

Provide a single, deterministic dispatch endpoint that routes a request to the most appropriate LiteLLM model alias **based on a declarative `task` field supplied by the caller**, so task-tier selection no longer depends on each client (Hermes pane, cron job, Droid, script) independently knowing and hardcoding the correct alias. Today task routing exists at the *alias* layer (each tier is a named model — `t2x-coding-nemotron-super`, `t0-vision`, etc.) but every caller must pick the alias itself; there is no central place that maps "this task = that model". This FRS defines that central classifier so a caller sends `{"task": "coding", ...}` and the routing layer resolves and dispatches the request — while retaining explicit-alias override for advanced/tooldown control.

---

## 2. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-18 | Initial specification |

---

## 3. Current Baseline

### 3.1 LiteLLM gateway (`~/.hermes/litellm/config.yaml`, container `litellm-proxy`, port 4000)

- Single OpenAI-compatible endpoint `http://127.0.0.1:4000/v1`, no `master_key` (local-only).
- 10 registered model aliases (verified live 2026-08-18):

| Alias | Upstream model | Task role |
|-------|---------------|-----------|
| `t0-extractor` | `ollama/ornith:9b` (local) | Structured extraction |
| `t0-vision` | `ollama/qwen3-vl:4b` (local) | Vision / images |
| `t2-orchestrator` | `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | General orchestrator (primary, 1M ctx) |
| `t2c-orchestrator-blend` | `openrouter/deepseek/deepseek-v4-flash-0731:floor` | Paid fallback (dynamic cheapest) |
| `t2a-orchestrator-deepseek` | `deepseek/deepseek-v4-flash` direct | Paid fallback |
| `t2x-largectx-nemotron-lightning` | `nvidia/nemotron-3.5-lightning:free` | Large docs (1M ctx) |
| `t2x-coding-nemotron-super` | `nvidia/nemotron-3-super-120b-a12b:free` | Coding / Droids |
| `t2x-general-gemma` | `google/gemma-4-31b-it:free` | Reliable general fallback |
| `t2x-family-openai-oss` | `openai/gpt-oss-20b:free` | Cross-family diversity |
| `e1-fallback` | `groq/llama-3.3-70b-versatile` | Quota fallback ($0) |

- LiteLLM already owns *within-alias* routing (latency-based, health checks, cooldown). It does **not** perform cross-alias task inference from message content at one endpoint.

### 3.2 Caller-side task selection today

- Hermes panes: set model per pane via `/model` (switching requires restart for new aliases — in-session validation against cached list).
- Cron jobs / Droids: specify `model:` in job config or Mission Manifest.
- Scripts / curl: pass `model=` in the request body.
- Each caller must know the exact alias string for its task; there is no constraint that they map to the semantically "best" — a missing or mistyped alias silently routes to whatever fallback.

**Gap:** No single, deterministic, auditable point maps "task type → model alias". Callers either hardcode aliases (fragile) or fall through to default (`t2-orchestrator`). Task-tier routing is implicit and caller-dependent, not explicit and centralized.

---

## 4. Requirements

### 4.1 FEATURE-01: Task-Classification Dispatch Endpoint

**Priority:** P1  \
**Effort:** Small (~1 day)

**User Story:** As Hermes (Director), I can send a request to one routing endpoint with a declarative `task` field (`{"task": "coding", "messages": [...]}`) and have the router deterministically forward it to the model alias best suited to that task — with explicit `model` override preserved for callers that need it.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | The router SHALL expose a single OpenAI-compatible chat endpoint (e.g. `/v1/chat/completions`) and SHALL accept an optional top-level `task` field alongside the standard chat payload | Must |
| F01-R02 | The router SHALL map each supported `task` value to exactly one model alias via a declarative, versioned mapping table (defaults below) | Must |
| F01-R03 | When `task` is present, the router SHALL forward the request to the mapped alias; a per-request `model` field, when present, SHALL take precedence over `task` | Must |
| F01-R04 | When both `task` and `model` are absent, the router SHALL dispatch to the default orchestrator alias (`t2-orchestrator`) | Must |
| F01-R05 | An unrecognised `task` value SHALL be treated as an unknown-task error (deterministic, structured) and MUST NOT silently fall through to the default alias | Must |
| F01-R06 | The router SHALL record each dispatch decision (task → alias, or override) as a structured audit line (timestamped) for telemetry and debugging | Must |
| F01-R07 | The router SHALL be stateless and idempotent — it forwards the request body unchanged (adding only the resolved alias) and SHALL NOT modify messages, streaming, or response semantics | Must |
| F01-R08 | The router SHOULD support both streaming (`stream: true`) and non-streaming passthrough without altering the behaviour either way | Should |

**Default task → alias mapping:**

```text
task "vision"            → t0-vision                    # images/OCR — local qwen3-vl
task "extract"           → t0-extractor                 # structured extraction — local ornith
task "coding"            → t2x-coding-nemotron-super    # code / Droids — nemotron-3-super-120b:free
task "largectx"          → t2x-largectx-nemotron-lightning  # >100K-token documents — 1M ctx
task "general"/"default" → t2-orchestrator              # orchestrator primary — nemotron free 1M ctx
```

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F01-N01 | Additional latency over direct alias dispatch | ≤ 20 ms (local process, no provider latency added) |
| F01-N02 | Mapping changes apply without downtime | Config-reload/restart, ≤ 1 restart |
| F01-N03 | Determinism | Same `task` value always yields same alias (no model/LLM in the mapping) |
| F01-N04 | Audit retention | One line per dispatch, appended; no retention requirement |

**Acceptance Criteria:**

```text
AC1: POST {"task":"coding","messages":[...]} → upstream receives model="t2x-coding-nemotron-super"
AC2: POST {"task":"vision",...} → upstream receives model="t0-vision"
AC3: POST {"model":"t2-orchestrator","task":"coding",...} → upstream receives model="t2-orchestrator" (override wins)
AC4: POST {"messages":[...]} (no task, no model) → upstream receives model="t2-orchestrator" (default)
AC5: POST {"task":"nonexistent-task",...} → deterministic unknown-task error, no silent fallback, audit line recorded
AC6: stream:true request with task="coding" → SSE stream passes through unchanged, alias resolved to coding tier
AC7: Unknown or absent task maps only via the versioned table; concurrent requests with different tasks resolve independently
```

---

### 4.2 FEATURE-02: Explicit-Alias Override & Task Registry

**Priority:** P2  \
**Effort:** Small

**User Story:** As a power caller (a specific cron or Droid), I can bypass task classification entirely by sending an explicit `model` — and any new task type can be added to the mapping by editing a single declarative table, versioned and audited.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | The router SHALL accept an explicit top-level `model` field with a valid registered alias and forward to it, bypassing task lookup | Must |
| F02-R02 | The task→alias mapping SHALL be stored as a versioned declarative table (config file/YAML), not hardcoded in logic | Must |
| F02-R03 | The mapping table SHALL carry a version and audit header (last-edited date + reason) to satisfy the FRS change-log discipline | Should |
| F02-R04 | The router SHALL expose a `/v1/tasks` (or config) endpoint listing the current task map for discovery and debugging | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | New task types | Additive config edit, no code change |
| F02-N02 | Bad `model` value | Deterministic error (never silent default) |

**Acceptance Criteria:**

```text
AC1: POST {"model":"t2x-general-gemma",...} → upstream receives model="t2x-general-gemma" (bypasses task map)
AC2: POST {"model":"not-a-real-alias",...} → deterministic invalid-alias error, audit line, no silent fallback
AC3: Adding `task "summarize" → t2-orchestrator` to the config table takes effect after reload with no code change
AC4: `/v1/tasks` lists current mapping with version header
```

---

## 5. Out of Scope

- **Content-based inference** — no LLM/embedding classification of message content; `task` is declarative only. (Keyword sniffing is explicitly rejected: non-deterministic, brittle.)
- **Modifying LiteLLM routing internals** — the shim is a thin forwarder in front of `:4000`; it does not change LiteLLM config, fallback chains, or cooldown.
- **Automatic `task` tags from within the message** — callers must supply `task`; there is no introspection of the payload.
- **Dashboard/UI for the mapping** — YAML edit + `/v1/tasks` read is sufficient for v1.
- **Auth on the shim endpoint** — local-only, same trust model as the LiteLLM gateway (no `master_key`); remains an explicit non-goal unless the mesh is broadened.

---

## 6. Dependencies & Related Documents

| Artifact | Relation |
|----------|----------|
| `~/.hermes/litellm/config.yaml` | Source of truth for alias list the shim dispatches to (FRS-009 F01-R01 depends on these aliases remaining stable) |
| `litellm-gateway` skill | Operational model of the gateway the shim fronts; restart/verify patterns reused |
| Fleet panes / cron / Droid (Mission Manifest `model:` field) | Callers that can adopt `task` dispatch |
| `edgegde-spec-authoring` skill | This FRS authored per the docs/ convention (FRS→SDD→IDD trail) |
| AGENTS.md | Governance: docs write = `action.write_documentation`, Hermes-allowed; implementation of source code (.ts/.py) requires Droid path |

---

## 7. Suggested Phasing

| Phase | Scope |
|-------|-------|
| 1 | Standalone shim (single-file) implementing F01, default 5-task map, `/v1/chat/completions` + `/v1/tasks`, audit logging; smoke-test against each alias via curl |
| 2 | Explicit-override + versioned config table (F02), rename/expose on a stable port (e.g. `:4001`), document caller adoption (fleet `/model`, cron `model:`, Droid manifest `task:`) |
| 3 | Optional: stream the dispatch into the mission audit trail / telemetry; harden edge cases (concurrency, alias drift) |