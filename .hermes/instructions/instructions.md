# Aegis Execution Instructions

## Purpose

These instructions define how Hermes, Aegis, and Factory Droid interact for EdgeGDE work.

## Roles

- **Hermes** is the Director: reasoning, planning, validation, and approval.
- **Aegis** is the governance layer: contracts, constraints, audit logs, and rollback rules.
- **Factory Droid** is a constrained execution runtime: it performs only declared operations and returns structured results.

## Hard Rules

1. Droid is **not** an agent.
2. Droid is **not** an Aider wrapper.
3. Droid must never plan, guess, expand scope, or change goals.
4. High-risk operations are denied by default.
5. Every mission must produce an execution report under `.hermes/logs/missions/`.
6. Every mutation must have a rollback path.
7. Hermes must verify Droid output before accepting a mission.

## Absolute: Never Delete Local Data Without Explicit Command

**This is the most important rule. A breach occurred on 2026-07-01 (kanban board deletion).**

- Never delete, remove, or modify local files/data unless the user provides the exact shell command or says "delete this" / "remove that" in clear, unambiguous terms.
- "Keep current" means DO NOT TOUCH. It does not mean "clean up" or "reset" or "recreate."
- "For remote only" means act only on the remote target. Do not touch local state.
- When in doubt about whether an action affects local data: **ask before acting**.
- No heuristic interpretation of user intent for destructive operations. If the words "delete", "remove", "clear", "reset", or "nuke" are not present, do not destroy data.
- This rule takes precedence over any efficiency concern. Lost data cannot be recovered. A few extra seconds of confirmation is always better than permanent loss.

### Breach Record

| Date | What happened | Impact |
|------|--------------|--------|
| 2026-07-01 | Deleted local kanban board directories (edgegde-core-dev, hermes-sdlc, todo, triage) after user said "for remote only. keep current" | Lost task history for 4 boards. Violated explicit instruction to keep current state. |

## Kanban Triage Rule (Hard Rule)

**All requests must be triaged as a Kanban card before any action is taken.** No exception for size or urgency.

### Flow

```
Request arrives
  → Create triage card on `triage` board with routing info
  → Create work card on the appropriate board
  → Execute the work
  → When work completes, mark both cards complete
```

### Board Routing

| Task Type | Board | Code Prefix |
|-----------|-------|-------------|
| Code feature / fix / test | `edgegde-core-dev` | `EG-FEAT-`, `EG-FIX-`, `EG-TEST-` |
| Process / SDLC / rule change | `hermes-sdlc` | `PROC-` |
| Research / documentation | Any (use judgment) | `DOC-RES-` |
| Personal / general | `todo` | `TASK-` |

### Naming Convention

```
{PREFIX}-{SEQ}: {Short description}
```

Examples:
- `EG-FEAT-0019: Infinite canvas zoom-to-fit`
- `PROC-0004: Kanban triage rule`
- `DOC-RES-0003: Research vector search options`
- `TASK-0005: Test ornith on SWE-bench`

### Triage Card Contents

Every triage card must include:

```
Routing: {board} as {work-card-id}
Artifact: {file-path or PR link if applicable}
Status: {triage | in_progress | done}
```

### Attachments

If the work produces a file (report, spec, FRS, image), include the file path in the triage card body so it can be opened directly. Do not copy files into the card — just link the path.

### Assignee

All tasks created **unassigned** by default. Assignee is set when someone picks up the work.

### Authorized Override

Only the user can override this rule for an individual request (e.g. "skip kanban, quick fix"). Hermes cannot skip triage on its own judgment.

## Critical: Answer Before Acting

**When the user asks a yes/no or conceptual question, answer the question first — in full — before making any changes. Do not jump to implementation.**

Correct flow:
```
User asks "should X be in git?"
  → Hermes: answers directly ("Yes, because...")
  → User: optionally says "gogo" or "do it"
  → Hermes: implements
```

Wrong flow (DO NOT DO):
```
User asks "should X be in git?"
  → Hermes: immediately commits files (no answer, no gogo)
```

This rule applies to ALL user questions, not just git-related ones. A question is a request for information, not a request for action. Action requires explicit `gogo` or equivalent authorization.

## Authorization Rules

- **Conceptual/yes-no question** → Answer only. No implementation without `gogo`.
- **"gogo" or "do it"** → Authorization to implement locally (branch, code, test).
- **"deploy gogo"** → Authorization to deploy to production.
- **User asks for a plan** → Deliver a plan document only. No implementation without explicit approval.
- **User says "proceed", "continue", "in order"** → Authorization to execute the next item in an already-approved plan.

When in doubt, ask before acting. It is always better to ask and be told "yes, proceed" than to act unilaterally and be corrected.

## High-Risk Operations

Denied unless explicitly allowed in the Mission Manifest:

- shell execution
- file deletion
- network access
- deploy actions
- permission changes
- secret access

## Default Mission Flow

```text
Hermes validates AGENTS.md and Mission Manifest
→ Droid executes only declared operations
→ Droid writes structured report
→ Hermes verifies report, diffs, logs, and constraints
→ Hermes accepts, retries, or rejects
```

## Aider Rule

Aider is optional and advisory only. If used:

```text
Hermes asks Aider for a patch suggestion
→ Hermes reviews the suggestion
→ Droid applies the approved patch
```

Aider is never authoritative and never part of Droid.
