# Intent Driven Design (IDD): Agentic SDLC — Plan-Code-Validate at Scale

**Document ID:** IDD-012  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-11  
**FRS Reference:** [FRS-012](./FRS-012-agentic-sdlc-v1.md)  
**SDD Reference:** [SDD-012](./SDD-012-agentic-sdlc-v1.md)  

---

## 1. Purpose

IDD defines the *intent* behind each interface in SDD-012 — what each component is designed to achieve, the contracts it fulfills, and the invariants it maintains. This is the contract layer: implementers satisfy these intents; consumers rely on them.

---

## 2. Interface Contracts

### 2.1 `SpecRenderer.render(plan) -> html_artifact`

**Intent:** Produce a visual, renderable version of a mission spec so the human reviewer can see the target state before approving execution. The intent is *clarity before commitment* — a rendered spec reveals gaps, ambiguities, and missing details that prose alone hides.

**Contract:**
- Accepts a plan artifact (markdown + structured metadata)
- Produces an HTML artifact showing target state: routes, pages, data flow, component structure, or behavioral sequence as applicable
- Generated from the same source as the text spec — updating the spec updates the HTML (no drift) (F06-R03)
- Render must not block execution — < 2s (F01-N02)
- Non-UI specs (backend-only) may return a simplified rendering or skip — not required to render full UI

**Invariants maintained:** I1 (executable criteria), I8 (deterministic)

---

### 2.2 `GovernanceGate.check(mutation) -> Pass | Fail(details)`

**Intent:** Prevent bad mutations from being written by running the same checks CI would run, but *before* the write. The intent is *left-shifted quality* — catch problems at the point of execution, not in a post-merge CI run.

**Contract:**
- Accepts a proposed mutation (file path, diff, or operation description)
- Runs the same checks currently in Gate 3: `any` types, `console.log`, test fakes, governance policy violations
- Returns `Pass` → mutation may proceed
- Returns `Fail(details)` → mutation rejected; details include which check failed and why
- Check logic MUST be identical to CI Gate 3 — no divergence (F05-R03)
- Result is journaled as part of the action ledger (F05-R04)

**Invariants maintained:** I2 (identical checks), I3 (no Hermes review of intermediate diffs)

---

### 2.3 `CodeValidateLoop.execute(task, criteria, iteration_limit) -> Completed | Escalated(state, last_failure)`

**Intent:** Run a Code→Validate loop autonomously — write code, run verification, adjust on failure, repeat — without Hermes reviewing every intermediate step. The intent is *agent autonomy within bounds* — the agent drives the loop; Hermes only sees the start and the end (or the escalation).

**Contract:**
- Accepts a task, executable verification_criteria, and iteration limit
- Loop body:
  a. Apply the mutation (file write, patch, script) — passes through GovernanceGate first
  b. Run verification_criteria (see 2.4)
  c. If pass → return Completed
  d. If fail → adjust code based on failure feedback; increment counter
  e. If counter > iteration_limit → return Escalated with current state + last failure
- Every step is journaled (agent_id, owner_attestation, action, result) (FRS-007) (F02-R04)
- Does NOT require Hermes review of intermediate diffs (F02-R03)
- On escalation: returns enough detail for Hermes to decide retry vs. reject (F02-R05)

**Invariants maintained:** I3, I6 (journaled steps), I7 (escalation on limit)

---

### 2.4 `VerificationRunner.run(criteria) -> VerificationResult`

**Intent:** Execute an executable verification_criteria and return a deterministic pass/fail result. The intent is *self-validation* — agents verify their own work against measurable criteria, not prose descriptions.

**Contract:**
- Accepts a verification_criteria object:
  - `type: test_command` → run shell command, check exit_code + optional output pattern
  - `type: script` → run script, check stdout/stderr against expected
  - `type: http_check` → hit endpoint, check status + body pattern
  - `type: state_check` → inspect file/state, check condition
- Returns `VerificationResult`:
  - `status: pass | fail`
  - `criterion` (the check that ran)
  - `result` (structured output: exit_code, tests_passed, body, etc.)
  - `timestamp`
- MUST be deterministic — same inputs → same result (F03-R02)
- Re-running the same criterion on unchanged code gives the same result

**Invariants maintained:** I8 (deterministic)

---

### 2.5 `ParallelCoordinator.track(mission) -> Aggregation`

**Intent:** Manage parallel task execution across multiple worktrees/agents, track status, aggregate results, and enforce shared mission budget. The intent is *throughput without chaos* — concurrency that scales output, not failures.

**Contract:**
- Accepts a mission manifest with tasks marked `parallel: true`
- Creates worktree per parallel task (isolated filesystem) (F04-R02)
- Spawns Droid instance per worktree (or delegates to sub-agent)
- Tracks status of each task: pending, running, completed, failed, escalated
- Aggregates results: all pass → mission success; any fail → report specific failures
- Enforces shared mission budget across all parallel tasks (aggregate accounting) (F04-R04)
- On failure: triggers Saga compensation for the failed task per manifest policy (F04-R05)
- Max parallel tasks configurable (default 5) (F04-N01)

**Invariants maintained:** I4 (worktree isolation), I5 (shared budget), I6 (journaled steps)

---

### 2.6 `MissionManifest.verification_criteria` (extended field)

**Intent:** Make verification criteria executable, not descriptive. The intent is that a criterion is a *check the agent can run itself*, not a description Hermes must interpret.

**Contract:**
- Field type: object, not string
- `type` ∈ {`test_command`, `script`, `http_check`, `state_check`}
- `command` / `script` / `endpoint` / `path` depending on type
- `expected` — structured condition (exit_code == 0, stdout contains X, status == 200, file exists, etc.)
- `timeout` — optional per-criterion timeout
- A mission SHALL NOT pass GATE with any mutating task missing executable verification_criteria (F01-R05)

**Invariants maintained:** I1 (executable criteria before GATE)

---

## 3. Interface Intent Summary

| Interface | Designed to achieve | Must never do |
|-----------|--------------------|---------------|
| `SpecRenderer.render` | Visual clarity before commitment | Drift from source spec; block execution |
| `GovernanceGate.check` | Catch bad mutations before write | Diverge from CI checks; allow bad mutation through |
| `CodeValidateLoop.execute` | Agent-autonomous code→validate loop | Require Hermes review of every diff; silent failure on limit |
| `VerificationRunner.run` | Deterministic self-validation | Return ambiguous prose; non-deterministic results |
| `ParallelCoordinator.track` | Concurrent throughput with isolation | Filesystem conflicts; per-task double budgeting |
| `verification_criteria` (field) | Executable checks, not prose | Require Hermes interpretation; allow GATE without criteria |

---

## 4. Invariants Maintained Across Interfaces

Cross-cutting invariants from SDD-012 §6 that no single interface may violate:

- **I1 (executable criteria):** enforced by GATE check on manifest — no mission with missing criteria passes
- **I2 (identical governance checks):** enforced by GovernanceGate using same check logic as CI
- **I3 (no Hermes intermediate review):** enforced by CodeValidateLoop — Hermes sees only start + end + escalation
- **I4 (worktree isolation):** enforced by ParallelCoordinator creating separate worktrees
- **I5 (shared budget):** enforced by ParallelCoordinator using aggregate accounting (FRS-007)
- **I6 (journaled steps):** enforced by CodeValidateLoop + GovernanceGate journaling every step
- **I7 (escalation on limit):** enforced by CodeValidateLoop returning Escalated, not silent failure
- **I8 (deterministic validation):** enforced by VerificationRunner producing reproducible results

---

## 5. Design Intent Notes

1. **Why executable criteria instead of prose:** Prose criteria ("tests should pass") require Hermes to interpret and re-verify. Executable criteria ("npx vitest run → exit_code 0") let the agent verify itself. This is the same principle Kun Chen applies: agents run validation, humans only review when something is ambiguous.

2. **Why left-shifted governance:** CI catches problems after merge — too late for a bad mutation to have already been written. Pre-mutation governance catches the same problems earlier, at the point of execution. This is not a replacement for CI (CI still runs post-merge) but a complement that catches issues before they reach CI.

3. **Why parallel worktrees:** Running parallel tasks in the same worktree risks filesystem conflicts (two agents editing the same file). Separate worktrees isolate each task's filesystem, mirroring the agent fleet policy (one worktree per agent). The coordinator aggregates results without filesystem contention.

4. **Why aggregate budgeting:** Kun Chen's insight about 20-30 parallel agents is that the *whole system* is bounded, not each agent. Per-task budgets would allow a mission to spend 5x its limit across 5 parallel tasks. Aggregate budgeting (FRS-007 FEATURE-02) means the mission as a whole has one budget, shared across all parallel work.

5. **Why iteration limit + escalation:** Unbounded loops are dangerous — an agent could iterate forever on a bug. The iteration limit bounds the loop; escalation ensures Hermes sees persistent failures rather than the agent spinning silently. The escalation report includes enough context (current state, last failure) for Hermes to make a routing decision.

6. **Why rendered specs:** Markdown specs are information-dense but visually sparse. A rendered HTML/Canvas spec shows the target state — routes, pages, data flow — in a form the human can scan in seconds. This catches missing details before execution: a route that's described but not shown on the map, a page that's mentioned but has no visual representation.
