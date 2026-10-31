# Horizon Issue: F04/FRS-012 Operational Gaps — Post-Merge Tracking

**Opened:** 2026-10-12  
**Source:** F04 parallel coordinator merge (PR #243, #247, #248)  
**Owner:** — unassigned  
**Severity:** Tracking / alignment (no code change required)

---

## Context

FRS-012 Agentic SDLC (6 features, F01–F06) is now fully merged on main:
- F01: executable `verification_criteria` in Mission Manifest
- F02: autonomous Code→Validate loop (Droid)
- F03: deterministic VerificationRunner
- F04: parallel worktree dispatch with shared budget (F04-R04, FRS-007 F02-R10)
- F05: pre-mutation governance gate (left-shifted Gate 3)
- F06: SpecRenderer (markdown → HTML)

F04 specifically added real worktree creation, `bun install` per worktree, parallel dispatch via `ThreadPoolExecutor` (bounded by `max_concurrent`), aggregate budget accounting (`budget_used_total_ms` vs `budget_limit_ms`), `budget_exhausted` hard stop, `droid/execute.py` wrapper, and cleanup with `git worktree prune`.

All 7 CI checks pass on #243, #247, #248. Integration test `tests/test_droid_f04.py` covers 4 scenarios (worktree creation, execute.py end-to-end, parallel dispatch + budget, budget hard stop).

---

## Open Gaps (Tracking)

### 1. Budget Accounting — Duration Only (FRS-007 F02)
**Current:** `Budget` tracks only `max_duration_seconds` (converted to ms). Per-task `budget_used` is wall-clock ms. Aggregate `budget_used_total_ms` vs `budget_limit_ms`. Hard stop at limit works.

**Expected per FRS-007 F02-R01..R10:**  
- `max_tokens`, `max_cost_usd`, `max_tool_calls`, `max_duration_seconds` all declarable on mission  
- Pre-flight estimation before execution (reject if estimate > ceiling)  
- Real-time step-granularity accounting (tokens, tool calls, elapsed time) via execution wrapper  
- Budget stop triggers manifest's Saga path per `partial_failure_policy`  
- Each budget-limited run journals `budget_used` vs `budget_limit` per dimension

**Impact:** Duration-only means a runaway agent can blow token/cost budgets silently. Pre-flight estimation would catch overshoot before execution.

**Recommendation:** Extend `Budget` dataclass + `ParallelCoordinator` accounting to include tokens/cost/tool_calls. Add a pre-flight estimator in `droid/execute.py` (or a new `budget_estimator.py`) that runs before dispatch. Wire Saga compensation (`tools/saga.py`) on budget stop.

---

### 2. Scalability Expectation — 20–30 Parallel Agents
**Origin:** Kun Chen agentic workflow (YouTube 88B6DimMD2g) — "20–30 parallel agents" in simulation; real-world 0.25 TPU-days/week with loop gain.

**Current:** F04 tested with 2 parallel tasks. `max_concurrent` defaults to 5. Worktree creation is sequential (git single-repo limit); worker dispatch parallelises.

**Gap:** No validation of 20–30 parallel tasks. Known bottlenecks at scale:
- Worktree creation serialised against one `.git` (mitigation: use `--detach` + sparse checkout?)
- `bun install` per worktree (mitigation: shared node_modules via pnpm workspaces or container reuse)
- `git worktree prune` cleanup at scale (potential contention on `.git/worktrees`)
- Budget hard-stop race conditions when many tasks check limit simultaneously

**Recommendation:** Add a scale test target (10, 20, 30 parallel tasks) in CI or as a manual benchmark. Profile worktree creation time, disk usage, and budget accounting contention. Document the practical ceiling before architectural changes (e.g. ephemeral containers instead of worktrees).

---

### 3. Saga Compensation — Logged Only, Not Wired
**Current:** `mark_failed()` logs "Saga compensation per manifest". `tools/saga.py` exists but is not called from `ParallelCoordinator`. Compensation is manual.

**Expected:** On task failure → Saga compensation runs automatically per `saga.partial_failure_policy` (`compensate_all` | `stop` | `continue`). Per-task `compensate` block in manifest executed.

**Recommendation:** Import `tools.saga` in `ParallelCoordinator` and invoke on failure. Add a test: one task fails → Saga rolls back the other completed task's worktree changes.

---

### 4. droid/execute.py — Mutating Path Uses No-op Adjust
**Current:** Mutating tasks in `execute.py` instantiate `CodeValidateLoop` but pass `adjust=lambda content, failure: content` (no-op). The loop runs once, governance passes, verification fails, loop returns `rejected` or `escalated` without ever adjusting code.

**Expected:** The `adjust` callback is the agent's reasoning step — in a full mission, the Droid sub-agent provides this. Current `execute.py` is a standalone worker; it has no agent to call.

**Gap:** `execute.py` works for read-only + governance-rejected tasks, but mutating tasks that fail verification never get a second attempt because there's no agent to generate the fix.

**Recommendation:** Document the contract: `execute.py` is the *worker substrate*; the `adjust` callback is provided by the agent runtime (Hermes → sub-agent). Add a `--adjust-cmd` flag to `execute.py` that points to a script/agent that generates the fix, so `execute.py` can be run standalone in a test with a dummy adjuster. This unblocks mutating-task integration tests.

---

### 5. Worktree Creation Bottleneck at Scale
**Current:** `create_worktree()` runs `git worktree add --no-checkout`, `git checkout`, `bun install` sequentially per task. For 20–30 tasks, this is minutes of serial time.

**Mitigations to evaluate:**
- `--detach` + sparse checkout (only files in `task.scope`) to reduce checkout time
- Shared `node_modules` via `pnpm install --shamefully-hoist` at repo root, then symlink per worktree
- Pre-warm a pool of worktrees at fleet start (agents pick from pool instead of creating on demand)
- Container-based isolation (Docker/Podman) instead of git worktrees — but loses git semantics

**Recommendation:** Benchmark current create+install time per worktree (target < 10s). If >30s at 10 parallel, implement sparse checkout + shared node_modules. Track in a separate spike branch.

---

## Decision Points for Next Review

| Item | Decision Needed |
|------|-----------------|
| Budget dimensions | Add tokens/cost/tool_calls now, or wait for first real mission that needs them? |
| 3-agent coordination | Prototype end-to-end with 3 agents on a real mission, or wait for scale test? |
| Saga wiring | Wire `tools/saga.py` now (low risk) or after first failure-mode test? |
| Adjust callback | Add `--adjust-cmd` to `execute.py` now, or wait for agent runtime integration? |
| Scale target | Define "done" for 20–30 parallel: CI gate, manual benchmark, or defer? |

---

## Related Artifacts

- PR #243 — FRS-012 base (6 features)
- PR #247 — F04 worktree creation + Droid dispatch
- PR #248 — F04 follow-ups (parallel dispatch, budget, execute.py, test placement)
- `tests/test_droid_f04.py` — 4 integration tests
- `tools/saga.py` — existing Saga implementation (not yet wired)
- `~/hermes-master/05_DOCS/frs/FRS-007-action-ledger-budget-guardrails-v1.md` — budget requirements (F02-R01..R10)
- `~/hermes-master/05_DOCS/frs/FRS-012-agentic-sdlc-v1.md` — spec for all 6 features

---

**Note:** This issue is *tracking only* — no code change required in this PR. Each gap above should become a separate PR when prioritised. The purpose is visibility and alignment before the next wave of work.