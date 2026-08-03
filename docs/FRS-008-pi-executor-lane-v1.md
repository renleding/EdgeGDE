# Functional Requirements Specification (FRS): Reversible Pi Executor Lane

**Document ID:** FRS-008  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-08-04  \
**Source:** Pi (pi.dev, earendil-works/pi v0.83.0) evaluation — terminal agent harness review; live smoke-test 2026-08-04 (print + JSON modes via local Ollama ornith:9b)

---

## 1. Objective

Add Pi (pi.dev) to the EdgeGDE executor chain as a **reversible, deprecation-first lane**: a config-flagged external executor (`executor: pi`) invoked behind the existing Droid wrapper, never wired into the state machine, never owning lifecycle. The lane exists to evaluate Pi's three distinct capabilities against EdgeGDE workloads — JSON-mode event streams for deterministic audit traces, session trees for branchable/shareable investigations, and minimal-system-prompt token efficiency on local models — without committing to it. Full deprecation must remain a two-command operation with zero EdgeGDE core coupling.

---

## 2. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-04 | Initial specification |

---

## 3. Current Baseline

### 3.1 Executor Chain (Droid → Coder → fallback)

The executor priority order (governed by `agent-selection-matrix`, implemented in `tools/swe-bench/adapter.py` via `call_llm()`):

```text
Droid provisions worktree → Coder (ornith:9b via Ollama /api/chat) → full-file replacement
  → fallback: DeepSeek V4 Flash via OpenRouter
  → last resort: Aider / Claude Code / Codex as disposable subprocess (never state-machine wired)
```

- `tools/swe-bench/adapter.py` routes LLM calls via `LLM_PROVIDER`/`LLM_MODEL` env vars with a circuit breaker (max retries, dry-run support)
- External executors (Aider/Codex/Claude Code) are invoked as subprocesses only, with Hermes owning branch/commit/push/PR/merge lifecycle
- No executor is reachable via a runtime config flag today — executor choice is compile-time/env-var, not a per-mission manifest field

**Gap:** The fallback chain treats every external executor identically (subprocess, text-mode). There is no lane for an executor that exposes structured JSON event streams, no flag to select one per mission, and no zero-coupling evaluation path for a new harness.

### 3.2 Pi (pi.dev) — verified state 2026-08-04

- Pi v0.83.0 installed via `curl -fsSL https://pi.dev/install.sh | sh` → npm global (`/opt/homebrew/lib/node_modules/@earendil-works/`), binary at `/opt/homebrew/bin/pi`
- Local Ollama provider registered via user-level config `~/.pi/agent/models.json` (single file; `baseUrl http://localhost:11434/v1`, `api openai-completions`)
- Print mode verified: `pi -p "Reply with exactly: PING-OK" --provider ollama --model ornith:latest` → `PING-OK`, exit 0
- JSON mode verified: `pi -p "..." --mode json` emits structured NDJSON events (`session`, `agent_start`, `turn_start`, `message_start/update/end`) with per-token deltas, provider/model attribution, usage and zero cost on local models
- Config surface: `--provider`, `--model`, `--mode text|json|rpc`, `--print/-p`, `--no-session`, `--system-prompt`, `--append-system-prompt`, `--session-dir`, `--fork`
- Deprecation footprint verified: `npm uninstall -g @earendil-works/pi-coding-agent` + `rm -rf ~/.pi` removes the complete install; no EdgeGDE repo, worktree, cron, or state-machine changes exist

**Gap:** Pi exists on the machine but is not reachable from any EdgeGDE-controlled dispatch path; no FRS-defined contract governs how it may be invoked under governance.

---

## 4. Requirements

### 4.1 FEATURE-01: Pi Executor Lane (config-flagged, Droid-hosted)

**Priority:** P1  \
**Effort:** Medium (~2 days)

**User Story:** As Hermes (Director), I can select the Pi harness as the executor for a governed mission via a per-mission or per-adapter `executor: pi` flag, have Droid invoke it in JSON mode, capture its structured event stream as audit evidence, and revert to the default executor by flipping the flag back — with no code change and no residual coupling.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | The executor chain SHALL support an `executor` selection flag with values `ornith` (default) and `pi`, settable per mission (Mission Manifest) or per adapter env (adapter-level config) | Must |
| F01-R02 | When `executor: pi`, the Droid wrapper SHALL invoke Pi in JSON mode (`pi -p "<task>" --provider <p> --model <m> --mode json`) against a worktree or scratch workspace | Must |
| F01-R03 | The Pi provider/model SHALL default to `ollama`/`ornith:latest` (free local stack) and SHALL accept explicit override via manifest fields | Must |
| F01-R04 | Pi execution SHALL be non-interactive: `--print` mode, `--no-session` for ephemeral runs (or pinned `--session-dir` for retained trees), never the interactive TUI from Droid | Must |
| F01-R05 | The structured NDJSON stream SHALL be captured to the mission audit trail (`.hermes/logs/missions/{mission_id}.report.json` or sibling `.pi-events.jsonl`) with exit code, duration, and provider/model attribution | Must |
| F01-R06 | Pi SHALL be invoked as a disposable subprocess only — it MUST NOT own branches, commits, pushes, merges, or deploys; all lifecycle stays with Hermes/Droid | Must |
| F01-R07 | Flipping `executor` back to `ornith` SHALL fully restore default behavior with zero changes outside the flag value | Must |
| F01-R08 | If the `pi` binary is absent or exits non-zero, the lane SHALL fail deterministically with a structured error and SHALL NOT silently fall back to another executor without an explicit `fallback: true` manifest field | Should |
| F01-R09 | Pi runs SHALL respect the existing Droid constraints (allowed paths, forbidden paths, `allow_shell` semantics) — the lane SHALL NOT expand the Droid operation contract | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F01-N01 | Deterministic auditability | Every Pi run produces parseable JSON events; no free-form terminal output in the audit trail |
| F01-N02 | Reversibility | Deprecation = flag removal + `npm uninstall -g` + `rm -rf ~/.pi`; no EdgeGDE core diff |
| F01-N03 | Cost | Local Ollama path = $0/run; cloud models only via explicit manifest override |
| F01-N04 | Latency | First-token latency on local ornith:9b comparable to existing Coder path (~20 tok/s M1) |
| F01-N05 | Isolation | Pi config lives entirely under `~/.pi/`; nothing written into the EdgeGDE repo at runtime |

**Acceptance Criteria:**

```text
AC1: Given a Mission Manifest with executor:"pi", Droid invokes Pi in JSON mode and the
     report contains the full NDJSON event stream with exit code 0 and zero-cost usage.
AC2: Given executor:"ornith" (default), behavior is byte-identical to pre-FRS-008 baseline.
AC3: Given executor:"pi" and the pi binary removed, the lane fails with a structured error
     naming the missing binary — no silent fallback without explicit manifest consent.
AC4: Given a completed Pi mission, `rm -rf ~/.pi` + flag revert leaves the EdgeGDE repo
     with zero diff attributable to the lane (git status clean apart from the flag file).
AC5: Given executor:"pi" with no explicit provider/model, the run uses ollama/ornith:latest
     and reports usage cost of 0 in the audit trail.
AC6: Parallel Pi missions on different worktrees do not share session state unless an
     explicit shared --session-dir is declared in the manifest.
```

---

### 4.2 FEATURE-02: Pi Session Tree Bridge (evaluation capability)

**Priority:** P2  \
**Effort:** Small (~0.5 days, only after F01 proves out)

**User Story:** As an investigator, I can run Pi with a pinned `--session-dir`, let its tree-structured history accumulate, and export/share a session (`pi /share` → gist URL) for a governed review — while EdgeGDE retains the authoritative mission record.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | When a manifest declares `retain_session: true`, Droid SHALL invoke Pi with a pinned `--session-dir` under the mission evidence path | Should |
| F02-R02 | The session tree file(s) SHALL be referenced (path) in the mission report for later `/tree` navigation or `/export` | Should |
| F02-R03 | Session retention SHALL be opt-in per manifest; default remains `--no-session` ephemeral | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | Evidence locality | Session files live under the mission evidence tree, never scattered in `$HOME` |
| F02-N02 | Shareability | `/share` gist export usable for external review without exposing EdgeGDE internals |

**Acceptance Criteria:**

```text
AC1: Given retain_session:true, the report references a session file that `pi /tree` can reopen.
AC2: Given no retain_session field, no session file persists (ephemeral, --no-session).
AC3: A shared gist URL from a Pi session contains no EdgeGDE secrets or paths outside the
     declared scope.
```

---

### 4.3 FEATURE-03: Lane Telemetry & Performance Gate

**Priority:** P2  \
**Effort:** Small (~0.5 days)

**User Story:** As Hermes (Director), I can see Pi-lane usage (runs, duration, tokens, cost, success rate) alongside the tier-performance tracking already applied to browser automation tiers, so the deprecate-vs-promote decision is data-driven.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F03-R01 | Every Pi-lane run SHALL append a telemetry entry (timestamp, mission_id, executor, provider, model, duration_ms, exit_code, token usage, cost, verification result) to a JSONL lane journal | Must |
| F03-R02 | If Pi-lane failure rate exceeds 30% over a rolling 30-day window for any action class, the lane SHALL be flagged for review (mirror of browser tier-performance rule) | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F03-N01 | Journal format | JSON-Lines, append-only, same discipline as `action_journal.py` |

**Acceptance Criteria:**

```text
AC1: After ≥1 Pi mission, the lane journal contains a complete, parseable entry with all fields.
AC2: A simulated 30-day failure-rate breach produces a review flag (log entry or kanban comment).
```

---

## 5. Out of Scope

- **No Pi integration into the state machine** — Pi never becomes a Mission Manifest operation type or a Saga participant
- **No Pi lifecycle ownership** — Pi never branches, commits, pushes, merges, deploys, or reviews
- **No replacement of the Coder (ornith:9b) default** — ornith remains the default code generator; Pi is a lane, not a substitution
- **No MCP bridge for Pi** — Pi has no MCP; EdgeGDE's MCP stack (State Engine MCP, custom-tools) stays authoritative
- **No interactive TUI usage from Droid** — TUI remains a human-only surface
- **No sub-agent/plan-mode replication in Pi** — EdgeGDE delegate_task and spec-driven planning remain the governance path
- **No changes to `tools/swe-bench/adapter.py` routing semantics** — the lane is additive (flag + wrapper branch), not a rewrite

---

## 6. Dependencies & Related Documents

| Artifact | Relation |
|----------|----------|
| `tools/swe-bench/adapter.py` | Hosts `call_llm()` routing; executor flag consumed here or in the Droid wrapper |
| `tools/saga.py` | Mission lifecycle; Pi lane runs as a declared task with compensation semantics |
| `agent-selection-matrix` (skill) | Executor priority order; this FRS adds the `pi` lane as an explicit optional executor |
| `edgegde-sdlc` (skill) | SDLC phases; FRS-008 doc itself flows through branch → PR → CI |
| `~/.pi/agent/models.json` | Pi local-provider config (user-level, installed 2026-08-04) |
| `docs/FRS-007-action-ledger-budget-guardrails-v1.md` | Format precedent; audit-trail discipline applies to Pi lane journal |
| `apps/state-engine/action_journal.py` | JSONL telemetry precedent referenced by F03 |
| Kanban card `t_559c7e81` | Triage/work card for this feature |

---

## 7. Suggested Phasing

| Phase | Scope |
|-------|-------|
| 1 | FEATURE-01 core: `executor` flag, Pi JSON-mode invocation behind Droid, NDJSON capture to mission report, revert-verification (AC1–AC6) |
| 2 | FEATURE-03 telemetry: lane journal + 30% failure-rate review flag |
| 3 | FEATURE-02 session-tree bridge, gated on Phase 1 metrics (deprecate-vs-promote decision) |

**Exit criteria for the whole lane:** after ≥10 governed Pi missions with ≥70% success and ≥20% measured token-cost reduction vs equivalent Coder runs, promote to a first-class optional executor; otherwise deprecate via the 2-command path with this FRS marked superseded in the Change Log.
