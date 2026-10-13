# Agentic SDLC — Plan-Code-Validate at Scale — Design

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Mission Orchestration                        │
│  Hermes (Director)           Droid (Execution)                   │
│  ────────────────            ─────────────────                   │
│  Author spec                 Accept mission manifest              │
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
│  │  (HTML/Canvas)   │              │  (pre-mutation, F05)    │   │
│  │  F06             │              │  Same checks as CI       │   │
│  └─────────────────┘              └─────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Mission Manifest (`droid/mission_manifest.py`)

- `verification_criteria` is an object, not a string: `type` ∈ {test_command, script, http_check, state_check}, plus command/script/endpoint/path, `expected` (structured condition), `timeout`
- `Task.validate()`: mutating operations (write_text, patch, delete, shell) REQUIRE criteria; parallel tasks MUST have empty `depends_on`
- `MissionManifest.validate()`: returns error list; non-empty → GATE rejects
- Serialization: `to_dict()` / `from_dict()` / `to_json()` / `from_json()` for manifest interchange

### 2. Verification Runner (`droid/verification_runner.py`)

- `VerificationRunner.run(criteria) → VerificationResult`
- Four criterion types:
  - `test_command` — shell command, check exit_code + optional stdout pattern
  - `script` — run script file (shebang/py/sh auto-detected), check exit_code + output
  - `http_check` — HTTP GET, check status + body pattern
  - `state_check` — file/state inspection (exists/is_file/is_dir/content)
- `_check_condition(actual, expected)`: dict-field comparison first (primary path for dict results), then scalar contains/exists/not_exists
- Deterministic: same inputs → same result (F03-R02)

### 3. Code→Validate Loop (`droid/code_validate_loop.py`)

- `CodeValidateLoop.execute(initial_content, adjust) → CodeValidateLoopResult`
- Loop per iteration:
  1. GovernanceGate check on proposed content — `rejected` on fail (F05-R01)
  2. Write file
  3. VerificationRunner.run(criteria)
  4. pass → `completed`; fail → `adjust(content, last_failure)` callback
- Iteration limit (default 5): exhausted → `escalated` with last failure + current state
- `adjust` callback is the agent's reasoning step — takes current content + last failure, returns new content

### 4. Governance Gate (`droid/governance_gate.py`)

- Mirrors CI Gate 3 (`tools/governance-check.ts`): no-as-any, no-console-log, trailing whitespace, file size (2000), JSDoc exports, test-file-exists
- Changed-line scoping via `git diff -U0` when available
- `can_apply_mutation(path, content) → (allowed, report)` — decision point for Droid
- `check_diff(diff_content) → GovernanceReport` — pre-mutation diff check
- Same check logic as CI — no divergence (F05-R03)

### 5. Parallel Coordinator (`droid/parallel_coordinator.py`)

- DESIGN-LEVEL: worktree planning, status tracking, result aggregation
- `plan_worktrees()` returns paths — creation gated until fleet idle
- `validate_parallelism()`: parallel tasks must have no `depends_on`
- `mark_completed` / `mark_failed` / `aggregate_results`
- Shared mission budget (aggregate accounting per FRS-007) — integration point reserved

### 6. Spec Renderer (`droid/spec_renderer.py`)

- `SpecRenderer.render_from_markdown(path) → RenderResult` (html, title, sections, timestamp)
- Markdown → HTML: headings, tables, lists, inline code/bold, TOC with anchors
- Dark theme CSS embedded; single source of truth with text spec (F06-R03)
- `write(result, output_path)` / `write_from_markdown(in, out)`

## Data Flow

1. Hermes authors plan + manifest with executable criteria
2. Droid receives manifest → `manifest.validate()` → GATE
3. Per task: GovernanceGate pre-check → CodeValidateLoop
4. Loop: adjust → governance → write → verify → repeat or escalate
5. Parallel tasks: coordinator plans worktrees, tracks status, aggregates
6. Final: all verification criteria re-run; results reported

## Failure Modes

| Failure | Detection | Handling |
|---|---|---|
| Missing criteria | manifest.validate() | GATE rejects before execution |
| Governance fail | can_apply_mutation | Task `rejected`, logged |
| Loop exhaustion | iteration counter | Escalation report to Hermes |
| Non-deterministic check | re-run differs | Flagged; Hermes reviews |
| Worktree conflict | creation failure | Coordinator reports; no partial state |
