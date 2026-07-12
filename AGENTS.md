# EdgeGDE — Project Contract for Aegis-Governed Work

Version: `edgegde-contract-2026-06-11`  
Runtime: Cloudflare Workers  
Stack: Hono + TypeScript + D1 + KV + R2 + Durable Objects  
Current product version reference: `v0.9.7`

## 1. System Model

Aegis-governed EdgeGDE work uses three separated roles:

```text
Hermes = Director
Aegis  = Governance
Droid  = Constrained execution runtime
```

### Token Efficiency Policy

All agents in this repo MUST follow the **Token Efficiency 80/20 Owl** policy (`~/.hermes/policies/token_efficiency_owl.yaml`):
- Relevant context only — localized snippets, not full-file dumps
- Output caps: small 400, medium 2,000, large 4,000, absolute 6,000
- No filler — no polite closings, no restating the question
- History window: default 4 turns, max 8
- Hermes is orchestrator in code tasks — keep output under 800 tokens, delegate >20 line generations
- Before full reads, check if a grep/snippet suffices
- Before verbose responses, check if concise answer suffices

### Hermes owns

- requirements interpretation
- architecture decisions
- task decomposition
- Mission Manifest creation
- diff and constraint verification
- retry, rollback, and final acceptance decisions

### Droid owns

- deterministic execution of declared operations
- file edits only when explicitly authorized
- build/test execution only when explicitly authorized
- controlled shell commands only when explicitly allowed
- structured execution reports

Droid does **not** own planning, architecture, correctness, or scope.

## 2. Non-Negotiable SDLC Rules

- Follow the 5-phase state machine: DISCOVERY → ALIGNMENT → `gogo` → EXECUTION → VERIFICATION.
- Use `work/{short-description}` branches for code changes.
- No direct push to `main`.
- PR + CI required for merges.
- Aider is never the executor of record.
- Hermes is the final approver.
- Verify before declaring success.
- Log mission evidence under `.hermes/logs/missions/`.

## 3. Architecture Contract

### Runtime

Primary runtime code lives in:

```text
apps/edge-runtime/
```

Expected runtime concerns:

- Hono routes
- Cloudflare Workers bindings
- Durable Objects
- D1 migrations
- KV-backed tenant/config/artifact state
- deterministic chat, form, publish, and registry pipelines

### UI Builder

UI/editor code lives in:

```text
apps/ui-builder/UIBuilder/
```

Expected UI concerns:

- Tauri/Vue shell
- OpenPencil canvas/editor
- artifact publishing contract
- no silent schema drift from shared `op-schema`

### Shared schema

Shared schema lives in:

```text
packages/op-schema/
```

Rules:

- shared schemas are authoritative
- duplicates must be synchronized or removed
- schema changes require tests in `packages/op-schema`

### Documentation

For meaningful architecture, data-flow, version, or deployment changes, keep these in sync:

```text
README.md
TEACHING.md
TOPOLOGY.md
runbooks/
prompts/       ← Role-specific system prompts (Hermes, Aegis, Droid)
```

## 4. Droid Operation Contract

Droid accepts only structured operations from a validated Mission Manifest.

Allowed operation families:

```text
architecture_summary
read_file
list_dir
write_text
shell
delete
```

High-risk operation families are denied unless explicitly allowed by the Mission Manifest:

```text
shell
delete
network
deploy
permissions
secrets
```

### Default constraints

```json
{
  "allow_shell": false,
  "allow_delete": false,
  "allow_network": false,
  "allow_deploy": false,
  "allow_permissions": false,
  "allow_secrets_access": false,
  "allowed_paths": ["."],
  "forbidden_paths": [".git/**", "**/.env", "**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**"],
  "max_retries": 3
}
```

## 5. Mission Manifest Requirements

Every mission must include:

```json
{
  "mission_id": "stable-id",
  "objective": "human-readable goal",
  "autonomy_level": "low | medium | high",
  "saga": {
    "compensation_strategy": "reverse_order | parallel | manual",
    "partial_failure_policy": "compensate_all | stop | continue"
  },
  "tasks": [
    {
      "task_id": "step_1",
      "operation": "operation_name",
      "tool": "droid",
      "args": {},
      "scope": ["relative/path"],
      "depends_on": [],
      "idempotent": true,
      "verification_criteria": ["explicit verification rule"],
      "compensate": {
        "operation": "reverse_operation",
        "args": {},
        "condition": "on_failure"
      }
    }
  ],
  "constraints": {
    "allow_shell": false,
    "allowed_paths": ["."],
    "forbidden_paths": [".git/**", "**/.env"],
    "max_retries": 3
  },
  "context_snapshot": {
    "agents_md": "AGENTS.md",
    "policy_md": ".hermes/policies/policy.md",
    "instructions_md": ".hermes/instructions/instructions.md"
  }
}
```

### Saga Compensation (Compensating Transaction Pattern)

The Saga pattern ensures that if a multi-step mission fails partway through, all completed steps are automatically compensated (rolled back) in reverse order.

**Compensation strategies:**
- `reverse_order`: (Default) Compensate tasks in reverse dependency order. If task C depends on B depends on A, and C fails, compensate B then A.
- `parallel`: Compensate all completed tasks simultaneously. Use when compensations are independent.
- `manual`: Log all completed tasks but do not auto-compensate. Require human intervention.

**Partial failure policies:**
- `compensate_all`: (Default) If any task fails, compensate ALL completed tasks.
- `stop`: Stop at the failed task but do NOT compensate previously completed tasks. Requires human review.
- `continue`: Skip the failed task and continue with remaining tasks. Only safe for non-critical failures.

**Task compensation definition:**
Each task may define a `compensate` block with:
- `operation`: The reverse operation to undo this task (e.g., `delete_file` for `write_text`, `restore_checkpoint` for `shell`)
- `args`: Arguments for the compensation operation
- `condition`: When to trigger - `on_failure` (default), `on_reject` (Hermes verification rejection), `always` (compensate even on success — for staging/mock mode)

**Compensation flow:**
```
Task 1: File A → write_text(path=A, content=X)
  compensate: write_text(path=A, content=<original content from checkpoint>)

Task 2: File B → write_text(path=B, content=Y)
  compensate: write_text(path=B, content=<original content from checkpoint>)

Task 3: Run tests → shell(command="npm test")
  compensate: (no-op — tests have no side effects)

Failure on Task 3 → Droid executes compensations in reverse:
  Task 2 compensate → restore File B from checkpoint
  Task 1 compensate → restore File A from checkpoint
```

Checkpoints are always created before mutation (under `.hermes/checkpoints/`), so compensation is a simple restore operation for file-level tasks.

## 6. Verification Rules

Before mission success, Hermes must verify:

- manifest matched `AGENTS.md`
- Droid stayed within declared scope
- no high-risk operation ran without explicit approval
- diffs are expected or absent
- logs exist under `.hermes/logs/missions/`
- rollback/checkpoint exists for mutations
- Saga compensation path is defined for multi-step missions
- tests/typecheck/build results match the mission criteria
- no partial failure was left uncompensated (if Saga.partial_failure_policy triggers compensation)

## 7. Rollback & Saga Compensation

### Checkpoint (Before Mutation)

Before any mutation:

```text
snapshot target file or directory under .hermes/checkpoints/
```

### On Failure

```text
1. Identify failed task
2. Determine Saga compensation strategy:
   - reverse_order (default): compensate completed tasks in reverse dependency order
   - parallel: compensate all completed tasks simultaneously
   - manual: log completed tasks, require human intervention
3. Execute compensation operations
4. Restore checkpoints for compensated tasks
5. Log the compensation event with checksums
```

No silent rollback is allowed. The execution report must state whether rollback occurred and which compensations were executed.

### Reconciliation (Post-Failure)

After compensation, Hermes should run a reconciliation check:

```text
1. Verify all compensated files match their checkpoint originals (diff == 0)
2. Verify the mission log records the failure + compensation chain
3. Report: "Mission [id] failed at task [X]. Compensation: [Y tasks reversed]. State: [consistent|inconsistent]"
```

## 8. Aider Boundary

Aider may be used only as an advisory patch suggestion source.

Forbidden:

```text
Aider as Droid
Aider as authoritative executor
Aider changing scope
Aider committing, pushing, merging, or deploying
```

Required if Aider is used:

```text
Hermes reviews patch before Droid applies it
```

## 9. First Mission

The first mission is read-only architecture discovery:

```text
Analyze this codebase and produce a structured architecture summary.
No source tree mutations.
Governance logs are allowed.
```

Expected report fields:

```json
{
  "mission_id": "aegis-001-read-only-architecture-summary",
  "status": "success | failure",
  "operations": [],
  "diffs": [],
  "exit_codes": [],
  "test_results": {},
  "violations": [],
  "retry_count": 0,
  "timestamp": "ISO-8601"
}
```
