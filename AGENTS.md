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
  "tasks": [
    {
      "task_id": "step_1",
      "operation": "operation_name",
      "tool": "droid",
      "args": {},
      "scope": ["relative/path"],
      "depends_on": [],
      "idempotent": true,
      "verification_criteria": ["explicit verification rule"]
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

## 6. Verification Rules

Before mission success, Hermes must verify:

- manifest matched `AGENTS.md`
- Droid stayed within declared scope
- no high-risk operation ran without explicit approval
- diffs are expected or absent
- logs exist under `.hermes/logs/missions/`
- rollback/checkpoint exists for mutations
- tests/typecheck/build results match the mission criteria

## 7. Rollback Rules

Before mutation:

```text
snapshot target file or directory under .hermes/checkpoints/
```

On failure:

```text
restore latest snapshot or isolate failed changes
```

No silent rollback is allowed. The execution report must state whether rollback occurred.

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
