# System Design Document (SDD): Agentic SDLC — Plan-Code-Validate at Scale

**Document ID:** SDD-012  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-11  
**FRS Reference:** [FRS-012](./FRS-012-agentic-sdlc-v1.md)  
**IDD Reference:** [IDD-012](./IDD-012-agentic-sdlc-v1.md)  

---

## 1. Scope

Internal architecture for FRS-012: how Plan-Code-Validate autonomy, parallel agent concurrency, and left-shifted governance are built, where they live, and how data flows. Complementary to existing SDLC infrastructure (AGENTS.md state machine, Mission Manifest, Droid execution wrapper, Aegis policy).

---

## 2. Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────┐
│                      Mission Orchestration                        │
│                                                                  │
│  Hermes (Director)           Droid (Execution)                  │
│  ────────────────            ─────────────────                  │
│  Author spec                 Accept mission manifest             │
│  Define verification_criteria  Run Code→Validate loop           │
│  Approve GATE                Pre-mutation governance check       │
│  Handle escalations          Journal every step (FRS-007)       │
│  Aggregate results           Report pass/fail per task          │
└──────────┬──────────────────────────────────────┬───────────────┘
           │                                      │
┌──────────┼──────────────────────────────────────┼───────────────┐
│          ▼                                      ▼               │
│  ┌─────────────────┐              ┌─────────────────────────┐   │
│  │  Spec Renderer   │              │  Governance Gate         │   │
│  │  (Canvas/HTML)   │              │  (pre-mutation, F05)     │   │
│  │  F06             │              │  Same checks as CI       │   │
│  └─────────────────┘              └─────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     Parallel Execution Layer                      │
│                                                                  │
│  Coordinator                    Per-Task Droid                    │
│  ─────────────                  ───────────────                   │
│  Track task status              Worktree isolation                │
│  Aggregate results              Code→Validate loop                │
│  Manage budget (aggregate)      Governance pre-check              │
│  Trigger Saga on failure        Journal every step               │
└──────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Owner |
|-----------|----------------|-------|
| `SpecRenderer` | Render mission spec as HTML/Canvas artifact for human review | Hermes (planning phase) |
| `MissionExecutor` (Droid) | Run Code→Validate loop per task; pre-mutation governance check; journal every step | Droid |
| `Coordinator` | Track parallel task status; aggregate results; manage shared mission budget | Hermes or designated agent |
| `GovernanceGate` | Run Gate 3 checks before mutation; same checks as CI | Droid (pre-mutation) |
| `CodeValidateLoop` | Write → verify → adjust → repeat; iterate up to limit; escalate on exhaustion | Droid (sub-agent) |

---

## 3. Data Flow

### 3.1 Plan Phase

```text
1. Hermes receives mission request
2. Hermes authors plan artifact:
   - Objective, scope, constraints
   - Tasks with executable verification_criteria (F01-R02)
   - For UI/behavioral changes: rendered spec (F06)
3. Hermes reviews plan — ensures verification_criteria defined for all mutating tasks (F01-R05)
4. Plan enters ALIGNMENT → human/gateway approval → GATE
5. Approved plan passed to Droid as mission manifest
```

### 3.2 Code Phase (per task)

```text
1. Droid receives task from manifest
2. Droid runs GovernanceGate pre-check (F05-R01):
   - If FAIL → reject mutation, report failure, task ends
   - If PASS → proceed
3. Droid enters Code→Validate loop (F02-R02):
   a. Write code (file edit, patch, script)
   b. Run verification_criteria for the task (F03-R01)
   c. If PASS → task complete, journal success
   d. If FAIL → adjust code based on failure feedback; increment counter
   e. If counter > limit → escalate to Hermes (F02-R05)
4. Every step journaled with agent_id + owner_attestation (FRS-007) (F02-R04)
```

### 3.3 Validate Phase (aggregate)

```text
1. All tasks report completion (or escalation)
2. Coordinator aggregates results
3. Final verification: re-run verification_criteria for all completed tasks (F03-R01)
4. If all pass → mission success, report to Hermes
5. If any fail → report specific failures; Hermes decides retry vs. reject (F03-R04)
6. Verification report produced for Hermes review (F03-R06)
```

### 3.4 Parallel Execution (F04)

```text
1. Coordinator identifies tasks with parallel: true and no depends_on
2. Coordinator creates worktree per parallel task (F04-R02)
3. Each worktree runs independent Droid instance
4. All Droids share mission budget (aggregate accounting, FRS-007 FEATURE-02) (F04-R04)
5. Coordinator tracks status of each; aggregates on completion
6. On failure: Saga compensation per task (F04-R05)
```

---

## 4. Data Structures

### 4.1 Mission Manifest (extended)

```json
{
  "mission_id": "mission-42",
  "objective": "Add telemetry configurator page",
  "autonomy_level": "high",
  "plan": {
    "spec_ref": "docs/FRS-012-agentic-sdlc-v1.md#4.1",
    "rendered_spec_path": "docs/html/mission-42-spec.html"
  },
  "tasks": [
    {
      "task_id": "task_1",
      "operation": "write_text",
      "scope": ["apps/edge-runtime/src/x.ts"],
      "verification_criteria": {
        "type": "test_command",
        "command": "npx vitest run --testNamePattern='Configurator'",
        "expected": "exit_code == 0"
      },
      "parallel": true,
      "depends_on": []
    },
    {
      "task_id": "task_2",
      "operation": "patch",
      "scope": ["apps/edge-runtime/src/y.ts"],
      "verification_criteria": {
        "type": "script",
        "script": "scripts/verify-no-any-types.sh",
        "expected": "stdout contains '0 violations'"
      },
      "parallel": true,
      "depends_on": []
    }
  ],
  "budget": {
    "max_tokens": 25000,
    "max_tool_calls": 500
  },
  "saga": {
    "compensation_strategy": "reverse_order",
    "partial_failure_policy": "compensate_all"
  }
}
```

- `verification_criteria.type` ∈ {`test_command`, `script`, `http_check`, `state_check`}
- `verification_criteria.expected` is a structured condition, not prose
- `parallel: true` requires empty `depends_on`

### 4.2 Verification Result

```json
{
  "task_id": "task_1",
  "verification": {
    "status": "pass | fail",
    "criterion": "npx vitest run --testNamePattern='Configurator'",
    "result": {
      "exit_code": 0,
      "tests_passed": 12,
      "tests_failed": 0
    },
    "timestamp": "2026-10-11T10:00:00Z"
  }
}
```

### 4.3 Escalation Report (iteration limit reached)

```json
{
  "task_id": "task_3",
  "status": "escalated",
  "reason": "iteration_limit_exhausted",
  "iterations": 5,
  "last_failure": {
    "criterion": "npx vitest run --testNamePattern='Configurator'",
    "result": {
      "exit_code": 1,
      "failures": ["Expected Configurator page to render, got 404"]
    }
  },
  "current_state": {
    "files_modified": ["apps/edge-runtime/src/configurator.ts"],
    "last_attempt": "Added route handler but missed asset binding"
  }
}
```

---

## 5. File Structure

```text
~/.hermes/ (Hermes side — planning + coordination)
  plans/                   # Mission plan artifacts (markdown + rendered HTML)
    mission-{id}.md
    mission-{id}.html      # Rendered spec (F06)
  coordinators/            # Parallel task tracking (per mission)
    mission-{id}.json      # Task status, budget aggregate

apps/state-engine/         # Existing — extended
  action_journal.py        # Already journals every step (FRS-007)
  verify_report.py         # Already produces verification reports

droid/ (Droid execution wrapper — extended)
  governance_gate.py       # NEW: pre-mutation Gate 3 checks (F05)
  code_validate_loop.py   # NEW: Code→Validate iteration loop (F02-F03)
  parallel_coordinator.py  # NEW: worktree creation + status tracking (F04)
  verification_runner.py   # NEW: execute verification_criteria (F03)
  mission_manifest.py      # NEW: manifest with executable criteria (F01)
  spec_renderer.py         # NEW: render spec to HTML (F06)
```

---

## 6. Invariants

| # | Invariant |
|---|-----------|
| I1 | Every mutating task has executable verification_criteria before GATE (F01-R05) |
| I2 | Governance checks pre-mutation are identical to CI checks (F05-R03) |
| I3 | Code→Validate loop does not require Hermes review of intermediate diffs (F02-R03) |
| I4 | Parallel tasks run in isolated worktrees (F04-R02) |
| I5 | Mission budget is shared across parallel tasks — aggregate, not per-task (F04-R04) |
| I6 | Every step in Code/Validate phases is journaled (FRS-007) (F02-R04) |
| I7 | Iteration limit exhaustion escalates to Hermes, not silent failure (F02-R05) |
| I8 | Validation is deterministic — same inputs → same result (F03-R02) |

---

## 7. Failure Modes

| Failure | Detection | Handling |
|---------|-----------|----------|
| verification_criteria not executable | GATE check fails — mission rejected | Hermes rewrites criteria before execution |
| Governance check fails pre-mutation | Droid rejects mutation | Task ends with failure; logged; Saga may compensate |
| Code→Validate loop exhausts iterations | Iteration counter reaches limit | Escalation report to Hermes |
| Parallel task worktree conflict | Worktree creation fails | Coordinator retries or reports failure |
| Budget exhausted during parallel run | Aggregate accounting triggers hard stop (FRS-007) | Saga compensation per policy |
| Validation non-deterministic | Re-run gives different result | Flagged as unreliable criterion; Hermes reviews |

---

## 8. Verification Strategy

1. Unit: verification_criteria execution — run a criterion, check pass/fail correctness
2. Unit: governance gate — attempt mutation with `any` type, verify rejection
3. Unit: Code→Validate loop — simulate failure → adjust → pass within iteration limit
4. Unit: parallel worktree isolation — run two tasks in separate worktrees, verify no conflict
5. Integration: end-to-end mission with 3 parallel tasks, all passing verification
6. Acceptance: FRS-012 AC1–AC4 for each feature

---

## 9. Related Documents

- FRS-012 (source spec)
- IDD-012 (interface contracts and intent)
- FRS-007 (action ledger + budget guardrails — budget sharing dependency)
- AGENTS.md (state machine, mission manifest, verification rules)
- repo-worktree-policy (worktree creation for parallel tasks)
- EG-SEC-0002 (Gate 3 governance checks — same checks as pre-mutation gate)
