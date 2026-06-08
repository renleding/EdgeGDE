# EdgeGDE — Multi-Agent SDLC

## Overview

EdgeGDE uses a **Multi-Agent SDLC (MA-SDLC)** where Hermes acts as planner/governor
and Aider acts as executor on demand. This document defines the exact workflow,
responsibility boundaries, and guardrails for every code change.

---

## Core Principles

- **Hermes is the single authority** — decides what, validates output, approves merge
- **Aider is a tool** — writes code on instruction, has no persistence outside session
- **One branch = one task** — no long-lived branches, no reuse
- **PR-only to main** — no direct pushes, ever
- **CI must pass** — before merge, every time
- **Deterministic execution** — same inputs → same outputs, no agent improvisation

---

## Branch Strategy

### Structure

```
main              production (protected — PR only)
work/{task-id}    task execution (Hermes agent branch)
hotfix/{issue}    emergency fix (accelerated PR)
```

### Naming Convention

```
work/{short-description}
work/p8-upgrade-fix
work/prompt-system-refactor
work/widget-extraction

hotfix/{issue-description}
hotfix/null-pointer-crash
hotfix/config-migration-bug
```

Agent identity (routa, aider, etc.) never appears in branch names.

---

## Agent Responsibility Model

### Hermes (Planner / Director / Gatekeeper)

Hermes **ALWAYS**:

1. Defines task scope
2. Creates the `work/*` branch
3. Decides executor (Hermes codes directly vs Aider executes)
4. Enforces SDLC flow
5. Reviews all output
6. Runs validation (tests, typecheck)
7. Opens the PR
8. Approves the merge

### Aider (Executor)

Aider **ONLY**:

1. Writes code within defined file scope
2. Follows Hermes' inline instructions
3. Exits when done

Aider **NEVER**:

- Creates or switches branches
- Opens PRs
- Makes workflow decisions
- Runs validation independently

### Handoff Protocol (Hermes → Aider)

```bash
# Hermes ensures repo is clean and branch is ready
# then launches aider via PTY with inline instructions:

cd /path/to/repo
aider \
  --model claude-sonnet-4-20250514 \
  --no-auto-commits \
  --message "Task: <description>
Files in scope: <paths>
Constraints:
- All existing tests must pass
- No new dependencies
- Follow existing patterns in the file"
```

**Rules:**

- Instructions are passed inline via `--message` — never via spec files in the repo
- Aider has **no memory outside the session** — Hermes is the only persistent brain
- Hermes reviews output immediately after aider exits
- Hermes commits the code (not aider)

---

## Workflow (Master Flow)

```
 1. Hermes defines task
 2. Hermes creates work/* branch from main
 3. Hermes rebases onto latest main
    ┌──────────────────────────────┐
    │ 4. Decide executor:          │
    │    ├── Hermes codes directly  │
    │    └── Hermes → Aider (PTY)  │
    │        → Aider implements     │
    │        → Hermes reviews       │
    └──────────────────────────────┘
 5. Hermes commits code
 6. Hermes runs validation:
    ├── bun install --frozen-lockfile
    ├── bun test --filter="@edgegde/schema"
    └── bun run typecheck
 7. Hermes opens PR (base: main)
 8. CI runs automatically
 9. If CI fails:
    ├── Hermes diagnoses (flake? retry)
    └── Hermes fixes → commit → push → re-run CI
10. Hermes rebases onto latest main
11. Hermes squash-merges
12. Hermes tags (v0.9.x)
13. Branch deleted
14. Deploy
```

### Step Detail — Validation (Mandatory)

Before any PR, Hermes **must** run:

```bash
bun install --frozen-lockfile
bun test --filter="@edgegde/schema"
bun run typecheck
```

All three must pass. No exceptions.

### Step Detail — PR Creation

```bash
gh pr create \
  --base main \
  --title "feat: description" \
  --body "See PR template in .github/PULL_REQUEST_TEMPLATE.md"
```

### Step Detail — Squash Merge

```bash
gh pr merge --squash --delete-branch
git fetch origin main
git checkout main
git pull origin main
git tag v0.9.x -m "Brief description of what shipped"
git push origin --tags
```

---

## Decision Matrix — Hermes vs Aider

| Scenario | Execute with | Why |
|---|---|---|
| Architectural change | **Hermes** | Multi-file coordination, schema/lifecycle logic |
| New feature (complex) | **Hermes** | Needs full context awareness |
| Repetitive edits across files | **Aider** | Mechanical — let tool handle |
| Simple refactor | **Aider** | Well-defined, isolated |
| Debugging complex issue | **Hermes** | Requires reasoning, iteration |
| Schema/rules update | **Hermes** | Systemic impact |
| Test writing (boilerplate) | **Aider** | Repetitive pattern |

---

## Hotfix Flow

For production issues requiring immediate attention:

```
 1. Branch from main: hotfix/{issue}
 2. Implement fix (Hermes codes directly — no Aider for hotfixes)
 3. Run minimal validation (tests for affected area)
 4. Open PR (required — no exceptions)
 5. Squash merge immediately
 6. Tag + deploy
```

**Target SLA: < 3 minutes.** Hermes owns the decision. CI still runs but doesn't block the merge — it validates post-merge.

---

## Guardrails (Enforced)

| Rule | Enforcement |
|---|---|
| No direct push to main | GitHub branch protection |
| PR required | GitHub branch protection |
| CI must pass | GitHub branch protection |
| Hermes is final approver | Process — self-enforcing |
| 1 branch = 1 task | Process — Hermes discipline |
| Aider never merges | Process — Hermes reviews all aider output |

---

## Environment Baseline

| Requirement | Command |
|---|---|
| Install dependencies | `bun install --frozen-lockfile` |
| Run schema tests | `bun test --filter="@edgegde/schema"` |
| Type-check | `bun run typecheck` (apps/edge-runtime) |

---

## Deployment

Simple: **merge to main → deploy**.

```bash
# Deploy triggered by tag push
git push origin --tags
```

No staging environment currently. Hotfix path exists for production.

---

## Version Convention

```
v0.9.x    Manual increment after each squash merge
tag AFTER merge
tag = deploy trigger
```

No strict semver — increment manually when needed.

---

## First-Time Setup

```bash
git clone https://github.com/renleding/EdgeGDE.git
cd EdgeGDE
bun install --frozen-lockfile
```

---

## History

- `2026-06-08` — Migrated from single-agent (routa/*) to multi-agent SDLC
- `2026-06-08` — Branch convention changed from routa/* to work/* + hotfix/*
