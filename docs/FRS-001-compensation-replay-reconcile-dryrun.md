# FRS-001: EdgeGDE Action Lifecycle — Compensation, Replay, Reconciliation, Dry-Run

**Version:** 1.0.0  
**Status:** Draft for review  
**Author:** Hermes (Director Agent)  
**Date:** 2026-06-24  
**Source:** `docs/RESEARCH-SDLC-COMPARISON.md`

---

## Objective

Add four production-hardening capabilities to the EdgeGDE action lifecycle, moving the runtime from **linear stateless execution** to **closed-loop stateful control** with automatic failure recovery, regression testing, and safe preview.

Each capability is independently implementable. Dependencies between them are noted.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Cloudflare Workers + Hono + TypeScript |
| State | Durable Objects (AuditLedger, mission DO) |
| Schema | `packages/op-schema` |
| Tests | Vitest (`bun run typecheck`) |
| Observability | OTel → SigNoz |

---

## Commands

| Action | Command |
|--------|---------|
| Typecheck | `cd apps/edge-runtime && bun x tsc --noEmit` |
| Test | `cd apps/edge-runtime && bun run test` |
| Lint | `cd apps/edge-runtime && bun run lint` |
| Deploy staging | `cd apps/edge-runtime && wrangler deploy --config wrangler.staging.json` |

---

## Project Structure (affected files)

```
apps/edge-runtime/src/
  actions/
    action-lifecycle.ts    # NEW — core lifecycle (execute → reconcile → compensate)
    compensation.ts        # NEW — compensation registry and runner
    replay.ts              # NEW — replay engine (reads AuditLedger → replays against code)
  do/
    AuditLedger.ts         # MODIFY — add getEventsByMission, getCompensationState
  lib/
    mission.ts             # MODIFY — add dryRun(), reconcile() phases
    circuit-breaker.ts     # NEW — if we include #5 later
  types/
    action.ts              # MODIFY — add compensate?, dryRunOutput, reconcileDecision

packages/op-schema/
  action-schema.ts         # MODIFY — add compensatingAction field
  mission-schema.ts        # MODIFY — add dryRun mode flag

docs/
  FRs-001-compensation-replay-reconcile-dryrun.md  # THIS FILE
```

---

## FRS-1: Compensating Action Lifecycle

### Objective

When a mission action fails, the runtime automatically invokes compensation for all previously-succeeded sibling actions within the same mission. This prevents partial failure scenarios where some actions succeeded and others failed — leaving the system in an inconsistent state.

### Functional Requirements

**FR-1.1** — Each action definition MAY declare an optional `compensate()` function alongside `execute()`.

```typescript
// packages/op-schema/action-schema.ts
interface EdgeGDEAction<TInput = unknown, TOutput = unknown> {
  id: string
  type: string
  execute(ctx: ActionContext, input: TInput): Promise<ActionResult<TOutput>>
  compensate?(ctx: ActionContext, input: TInput, originalOutput: TOutput): Promise<void>
}
```

**FR-1.2** — The `compensate()` function receives the same input as the original `execute()` plus the original output. This allows it to reverse the action (e.g., delete what was created, subtract what was added).

**FR-1.3** — When any action in a mission fails (throws or returns `status: 'failure'`), the runtime MUST:
1. Record the failure in AuditLedger with action ID, error, and timestamp.
2. Identify all previously-succeeded sibling actions in the same mission.
3. For each succeeded action that has a `compensate()` function, call it **in reverse order** (LIFO — last succeeded compensated first).
4. Record each compensation attempt (start, success/failure) in AuditLedger.
5. If compensation itself fails, log the failure and CONTINUE — a failed compensation must not prevent other compensations from running.
6. Set mission status to `'compensated'` if all compensations succeeded, or `'compensated_partial'` if any failed.

**FR-1.4** — Actions that do NOT declare `compensate()` are skipped during compensation. Their side effects are not automatically reversed — this is intentional (some actions are idempotent or externally managed).

**FR-1.5** — Compensation execution MUST be observable via OTel. Each compensation call creates a child span under the mission trace:
- Span name: `action.compensate.{actionType}`
- Attribute: `app.correlation.id`
- Attribute: `app.action.id`
- Attribute: `compensates_action_id` — the original action being compensated
- Attribute: `compensation.status` — `success` | `failure`

**FR-1.6** — The compensation runner MUST enforce a maximum total compensation time (configurable, default 30s per mission). If exceeded, remaining compensations are marked as `'timeout'` and the mission is set to `'compensated_partial'`.

### Acceptance Criteria

- [ ] A mission with 3 actions where the 3rd fails: actions 1 and 2 are compensated in reverse order (2, then 1).
- [ ] A mission where compensation itself fails: remaining compensations still run, mission ends as `compensated_partial`.
- [ ] A mission with no compensable actions: mission ends as `failed`, no compensation attempted.
- [ ] OTel spans exist for each compensation call.
- [ ] AuditLedger records every compensation attempt with start time, end time, and status.

### Verification

```bash
cd apps/edge-runtime && bun run test -- --grep "compensation"
```

---

## FRS-2: Replay-Based Testing

### Objective

Enable regression testing of agent actions by replaying historical execution data (from AuditLedger + OTel traces) against the current code version. This catches regressions in action behavior before deployment — without needing a live environment or real external dependencies.

### Functional Requirements

**FR-2.1** — The AuditLedger Durable Object MUST expose a query method to retrieve all events for a given mission, ordered by sequence:

```typescript
// AuditLedger.ts — MODIFY
interface AuditEvent {
  missionId: string
  sequence: number
  actionType: string
  input: unknown
  output: unknown
  status: 'success' | 'failure' | 'compensated'
  timestamp: number
  correlationId: string
}

getEventsByMission(missionId: string, opts?: { fromSequence?: number, toSequence?: number }): Promise<AuditEvent[]>
```

**FR-2.2** — A replay engine MUST be created that:
1. Accepts an array of `AuditEvent` objects (from AuditLedger or a JSON fixture file).
2. Iterates through events in sequence order.
3. For each event, looks up the registered action by `actionType` and calls its `execute()` function with the event's `input`.
4. Compares the result against the original `output` and `status`.
5. Reports pass/fail for each event.
6. Does NOT call any `compensate()` functions or write to AuditLedger — replay is read-only.

```typescript
// replay.ts — NEW
interface ReplayResult {
  missionId: string
  totalEvents: number
  passed: number
  failed: number
  details: Array<{
    sequence: number
    actionType: string
    input: unknown
    expectedOutput: unknown
    actualOutput: unknown
    match: boolean
    error?: string
  }>
}

async function replayMission(events: AuditEvent[]): Promise<ReplayResult>
```

**FR-2.3** — The replay engine MUST support recording real mission data to JSON fixture files for use in tests:

```typescript
// In a test file
import { replayMission } from '../src/actions/replay'
import fixtures from './fixtures/mission-lead-scoring.json'

test('lead scoring mission replays correctly', async () => {
  const result = await replayMission(fixtures.events)
  expect(result.passed).toBe(result.totalEvents)
  expect(result.failed).toBe(0)
})
```

**FR-2.4** — Fixture files are recorded by running a mission in `--record` mode which dumps the AuditLedger events to a JSON file instead of executing real actions:

```bash
# Record a dry-run mission
bun run mission:record --mission-id lead-scoring-v1 --output tests/fixtures/lead-scoring.json
```

**FR-2.5** — Replay tests MUST be runnable as part of the standard test suite (`bun run test`). They should be in `apps/edge-runtime/tests/replay/`.

**FR-2.6** — When a replay test fails, the output MUST clearly show:
- Which event sequence number failed
- What the expected output was
- What the actual output was
- The diff between them

### Acceptance Criteria

- [ ] `AuditLedger.getEventsByMission()` returns events ordered by sequence for a given mission.
- [ ] `replayMission()` replays events and reports pass/fail per event.
- [ ] A fixture file can be recorded and used in tests.
- [ ] A test that passes with the recording fails when action logic changes (demonstrates regression detection).
- [ ] Replay tests run in CI as part of `bun run test`.

### Verification

```bash
cd apps/edge-runtime && bun run test -- --grep "replay"
```

---

## FRS-3: Reconciliation Loop

### Objective

Replace the current linear mission execution (execute all actions in order, then done) with a closed-loop reconciliation pattern. After each action, evaluate whether the desired state has been reached. If yes, complete. If not, either continue with the next action or, if drift exceeds threshold, compensate.

### Functional Requirements

**FR-3.1** — The mission lifecycle MUST include a `reconcile()` phase after each action execution:

```
execute(action N)
  ↓
reconcile() ← NEW
  ├── drift === 0 → complete mission
  ├── drift < threshold → continue with action N+1
  └── drift >= threshold → trigger compensation + halt
```

**FR-3.2** — The `reconcile()` function accepts the mission's desired state and the current state (after the last action), and returns a decision:

```typescript
// types/action.ts — MODIFY
type ReconcileDecision =
  | { action: 'complete' }
  | { action: 'continue'; nextActionId?: string }
  | { action: 'compensate'; reason: string }

interface ReconcileContext {
  missionId: string
  desiredState: Record<string, unknown>
  currentState: Record<string, unknown>
  executedActions: Array<{ actionId: string; type: string; output: unknown }>
  remainingActions: Array<{ actionId: string; type: string }>
  correlationId: string
}

type ReconcileFn = (ctx: ReconcileContext) => ReconcileDecision | Promise<ReconcileDecision>
```

**FR-3.3** — Each mission definition MAY declare a `reconcile` function. If none is declared, the runtime defaults to linear execution (complete after all actions, regardless of drift). Default behavior must match the current system — this is additive, not breaking.

```typescript
// mission-schema.ts — MODIFY
interface MissionDefinition {
  id: string
  actions: EdgeGDEAction[]
  reconcile?: ReconcileFn  // NEW — optional
  driftThreshold?: number   // NEW — optional, default Infinity (no drift check)
}
```

**FR-3.4** — The `reconcile()` function MUST be observable via OTel:
- Span name: `mission.reconcile.{missionType}`
- Attribute: `app.correlation.id`
- Attribute: `app.mission.id`
- Attribute: `reconcile.decision` — `complete` | `continue` | `compensate`
- Attribute: `reconcile.drift_score` — numeric drift value (if computed)

**FR-3.5** — The reconciliation loop MUST have a configurable maximum iteration count (default 50) to prevent infinite loops. If exceeded, the mission is halted with status `'loop_limit_exceeded'`.

**FR-3.6** — The `computeDrift()` helper function should be provided as a utility in `src/lib/mission.ts`:

```typescript
// lib/mission.ts — MODIFY
function computeDrift(
  desired: Record<string, unknown>,
  actual: Record<string, unknown>,
  threshold?: number,
): number
```

By default, it compares each key in `desired` against `actual`:
- Missing keys contribute `1.0` drift each.
- Numeric mismatches contribute `|desired - actual| / |desired|` drift each.
- String mismatches contribute `1.0` drift each.
- Nested objects are compared recursively.

### Acceptance Criteria

- [ ] Missions with no `reconcile` function behave exactly as they do today (backward compatible).
- [ ] A mission with `reconcile` that returns `complete` after the first action halts early.
- [ ] A mission with `reconcile` that returns `compensate` triggers compensation of all executed actions.
- [ ] Drift exceeding threshold triggers compensation.
- [ ] The loop limit prevents infinite execution.
- [ ] OTel spans record each reconciliation decision.

### Verification

```bash
cd apps/edge-runtime && bun run test -- --grep "reconcile"
```

---

## FRS-4: Dry-Run Mission Mode

### Objective

Allow users to preview what a mission will do before executing it. A dry-run validates the mission manifest against current state and reports expected actions, side effects, and potential issues — without mutating any state or calling external services.

### Functional Requirements

**FR-4.1** — The mission runner MUST accept a `--dry-run` flag. When set:
- Actions are NOT executed.
- The manifest is validated against current state.
- A report is returned describing what WOULD happen.

```typescript
// lib/mission.ts — MODIFY
interface DryRunReport {
  missionId: string
  valid: boolean
  actions: Array<{
    type: string
    input: unknown
    expectedOutputType: string
    sideEffects: string[]       // e.g., ["creates record in D1", "publishes to KV"]
    idempotent: boolean
    hasCompensation: boolean
  }>
  warnings: string[]
  errors: string[]
  estimatedDuration: string     // e.g., "~2.3s"
}

async function dryRunMission(manifest: MissionManifest, state: unknown): Promise<DryRunReport>
```

**FR-4.2** — Each action type MUST declare its side effects declaratively:

```typescript
// types/action.ts — MODIFY
interface EdgeGDEAction {
  // ... existing fields
  dryRun?(input: unknown, state: unknown): {
    expectedOutputType: string
    sideEffects: string[]
    idempotent: boolean
  }
}
```

**FR-4.3** — If an action does NOT declare a `dryRun()` function, the report lists it as `"unknown"` for side effects and `false` for idempotency, and adds a warning.

**FR-4.4** — The dry-run report MUST be serializable to JSON for API consumption:

```
POST /api/v1/missions/dry-run
{ "manifest": { ... } }
→ 200 { "report": { "valid": true, "actions": [...], "warnings": [] } }
```

**FR-4.5** — Dry-run MUST NOT:
- Call any `execute()` function.
- Write to AuditLedger.
- Mutate Durable Object state.
- Call external APIs (LLM providers, databases).

This is enforced at the runtime level, not delegated to individual actions.

**FR-4.6** — Dry-run MUST be observable via OTel (read-only span):
- Span name: `mission.dry_run.{missionType}`
- Attribute: `app.correlation.id`
- Attribute: `dry_run.valid` — boolean
- Attribute: `dry_run.action_count` — number of actions
- Attribute: `dry_run.warning_count` — number of warnings

### Acceptance Criteria

- [ ] A valid manifest returns a report with all actions listed, no errors.
- [ ] An invalid manifest (missing required fields, unknown action types) returns errors.
- [ ] An action without `dryRun()` produces a warning with `"unknown"` side effects.
- [ ] Dry-run does not write to AuditLedger or mutate any state.
- [ ] The API endpoint `POST /api/v1/missions/dry-run` returns the report as JSON.
- [ ] OTel span is created for the dry-run call.

### Verification

```bash
curl -s -X POST http://localhost:8642/api/v1/missions/dry-run \
  -H "Content-Type: application/json" \
  -d @fixtures/valid-manifest.json | jq .
```

---

## Dependencies Between Items

```
FRS-3 (Reconciliation) ────depends on──▶ FRS-1 (Compensation)
  └── reconciliation may trigger compensation

FRS-2 (Replay) ────depends on──▶ AuditLedger query support
  └── replay reads events from AuditLedger

FRS-4 (Dry-Run) ────independent──▶ No dependency on FRS-1/2/3
  └── can be implemented standalone
```

**Implementation order:** FRS-1 → FRS-3 → FRS-2 → FRS-4
(Compensation first because Reconciliation depends on it. Replay depends only on AuditLedger query support, which is small. Dry-Run is independent and can be done in parallel.)

---

## Testing Strategy

| Capability | Test Level | Location | Coverage Target |
|-----------|-----------|----------|-----------------|
| Compensation lifecycle | Unit + Integration | `tests/actions/compensation.test.ts` | All FR-1.x |
| Replay engine | Unit | `tests/replay/replay-engine.test.ts` | All FR-2.x |
| Reconciliation loop | Unit + Integration | `tests/actions/reconcile.test.ts` | All FR-3.x |
| Dry-run | Unit + API | `tests/api/dry-run.test.ts` | All FR-4.x |

**Fixture storage:** `apps/edge-runtime/tests/fixtures/missions/*.json`

---

## Boundaries

### Always do
- Run typecheck before committing changes to any of the 4 capabilities
- Ensure backward compatibility — existing missions must work unchanged
- Add OTel spans for every new lifecycle phase
- Record all lifecycle events in AuditLedger

### Ask first
- Changing the default `reconcile` behavior (currently linear, matching today)
- Adding new action state transitions beyond `success | failure | compensated`
- Changing the AuditLedger schema (existing events must remain readable)

### Never do
- Expose internal compensation state through the public API
- Allow dry-run to accidentally execute real actions (enforce at runtime level)
- Remove or change existing AuditLedger event fields — only add new ones

---

## Success Criteria (Overall)

- [ ] All 4 FRS items have passing tests.
- [ ] All acceptance criteria marked `[ ]` above are verified.
- [ ] Existing mission tests pass unmodified (backward compatibility).
- [ ] OTel spans for all new lifecycle phases appear in SigNoz.
- [ ] AuditLedger records compensation events with the same `app.correlation.id` as the original mission.
- [ ] Dry-run reports are actionable: a developer reading the report can understand what the mission would do.
- [ ] Replay tests catch a regression (verified by intentionally breaking an action and confirming the replay test fails).

---

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Q1 — Compensation trigger | ✅ **Dual model** — automatic runtime compensation (FRS-1) + explicit mission reconcile (FRS-3) | Runtime handles safety rollback (local, bounded); mission handles domain reconciliation (selective, controlled). Either alone is unsafe. |
| Q2 — Replay fixture storage | ✅ **Repo** (`tests/fixtures/missions/`) | Deterministic, versioned, offline, PR-reviewable. R2 as secondary archive later if >100MB. |
| Q3 — Dry-run interface | ✅ **Both CLI + API**, single backend | CLI wraps `POST /api/v1/missions/dry-run`. No logic duplication — API is source of truth. |
| Q4 — Drift definition | ✅ **Structured state diff** — mismatch, missing, extra, stale, derived error categories | Drift = deterministic diff between expected mission state and actual system state. Pure function, no side effects, operates on projections not live mutation. |

### Drift Categories (formalized)

| Category | Description | Example |
|----------|-------------|---------|
| `missing` | Expected key not present | `{ status: "approved" }` but status field absent |
| `extra` | Unexpected key present | Actual has `{ refundId: "R1" }` but mission didn't specify it |
| `mismatch` | Value differs | Expected `status: "approved"`, actual `status: "pending"` |
| `stale` | Version outdated | Expected `version: 5`, actual `version: 3` |
| `derived_error` | Computed state wrong | Expected `bucket: "hot"` (score ≥ 80), actual score is 60 → `bucket: "warm"` |

### computeDrift() Signature

```typescript
type DriftCategory = 'missing' | 'extra' | 'mismatch' | 'stale' | 'derived_error'

interface DriftResult {
  key: string
  expected: unknown
  actual: unknown
  type: DriftCategory
  path?: string  // dot-notation path for nested fields
}

function computeDrift(expected: State, actual: State): DriftResult[] {
  // Pure function — no side effects, deterministic
}
```

---

## Open Questions (Resolved)

All 4 open questions have been resolved — see Resolved Decisions above.
