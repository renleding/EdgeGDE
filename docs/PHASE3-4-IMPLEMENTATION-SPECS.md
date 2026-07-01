# Phase 3-4: Implementation Specs — Remaining Governance Gaps

## EG-ARCH-0004: Replay Testing from Audit History
**Effort:** 3-5 days | **Priority:** P1

### What
Read AuditLedger events from a past mission and re-dispatch them through the verification pipeline to detect regressions.

### Implementation
1. Read `.hermes/logs/missions/{mission_id}.report.json` for execution traces
2. Extract the original mission manifest, operation list, and expected diffs
3. Re-execute the verification gates against the current codebase state:
   - `diff_hygiene` — check expected vs actual diffs
   - `test_run` — re-run tests from the mission
   - `patch_format` — validate patch still applies
4. Report: "Regression: 0 | Progress: 2 | Same: 5"

### Key Files
- `tools/verification-suite.ts` — extend with replay mode
- `.hermes/logs/missions/` — source data
- `tools/compare-baselines.ts` — extend for replay comparison

### Acceptance Criteria
- [ ] `hermes replay --mission-id EG-FEAT-0016` re-runs verification
- [ ] Output shows per-gate pass/fail against current codebase
- [ ] Regression detection: same mission on old code = pass, on broken code = fail

---

## EG-ARCH-0005: Reconciliation Loop
**Effort:** 1 day | **Priority:** P1

### What
After each action in a mission, run a `reconcile()` phase that compares desired vs actual state. If drift is detected, self-correct or escalate.

### Implementation
1. After each Droid operation, snapshot the actual state (file content, test results)
2. Compare against the expected state from the Mission Manifest
3. If mismatch:
   - Small drift (≤2 files): auto-correct with compensation + retry
   - Large drift: escalate to Hermes for decision
4. Log reconciliation result in audit trail

### Integration Points
- Droid execution lifecycle — add reconcile step after each operation
- AuditLedger — record reconciliation decisions
- Aegis governance — verify reconciliation results

### Acceptance Criteria
- [ ] After file write, reconcile confirms content matches expected
- [ ] Drift detected → logged and escalated
- [ ] No divergence between declared scope and actual changes

---

## EG-ARCH-0006: DAG Task Scheduler + Parallel Execution
**Effort:** 2-3 days | **Priority:** P2

### What
Replace the linear task execution model with a DAG-based scheduler that detects dependency cycles, executes independent tasks in parallel, and respects ordering constraints.

### Implementation
1. Parse Mission Manifest `depends_on` into a DAG
2. Validate: no cycles, all dependencies exist
3. Find root tasks (no dependencies) — execute in parallel
4. Fan-in: execute dependent tasks only after all dependencies complete
5. On failure: cascade abort to dependent tasks

### Algorithm
```python
def schedule(manifest):
    dag = build_dag(manifest.tasks)
    if cycles := detect_cycles(dag):
        raise CycleError(cycles)
    ready = [t for t in tasks if not t.depends_on]
    running = []
    while ready or running:
        # Launch all ready tasks in parallel
        for task in ready:
            running.append(execute(task))
        ready = []
        # Wait for any running task to complete
        done = wait_any(running)
        running.remove(done)
        # Unblock dependent tasks
        for task in tasks:
            if all(dep in completed for dep in task.depends_on):
                if task not in completed and task not in running:
                    ready.append(task)
```

### Acceptance Criteria
- [ ] Cycle detection rejects circular dependencies
- [ ] Root tasks execute concurrently
- [ ] Dependent tasks wait for all parents
- [ ] Failure cascades to dependents
- [ ] Mission log shows parallel execution order

---

## EG-FEAT-0001: Cross-Mission Memory
**Effort:** 1 day | **Priority:** P2

### What
Persist learnings and context between missions so each mission doesn't start from scratch.

### Implementation
1. After mission completion, extract structured summary:
   - What operations were performed
   - What failed and how it was compensated
   - What patterns were successful
   - Verification results
2. Store in `.hermes/memory/missions.db` (SQLite)
3. At mission start, inject relevant summaries from past missions:
   - Same file paths → past operations on those files
   - Same operation type → success/failure patterns
   - Same repository → previous context

### Schema
```sql
CREATE TABLE mission_memory (
    mission_id TEXT PRIMARY KEY,
    timestamp TEXT,
    objective TEXT,
    repo TEXT,
    files_affected TEXT,  -- JSON array
    operations TEXT,      -- JSON array of operation types
    success BOOLEAN,
    compensation_used BOOLEAN,
    verification_summary TEXT,
    lessons TEXT          -- LLM-extracted lessons
);
```

### Acceptance Criteria
- [ ] Mission completes → memory entry created
- [ ] New mission starts → relevant past memories injected
- [ ] User can query: "what happened with this file before?"
- [ ] Memory doesn't leak between tenants/projects

---

## Phase 3+ Implementation Order

1. **Reconciliation loop** (1 day) — smallest, highest ROI
2. **Cross-mission memory** (1 day) — standalone, high visibility
3. **Replay testing** (3-5 days) — requires verification-suite
4. **DAG scheduler** (2-3 days) — largest, depends on mission manifest stability
