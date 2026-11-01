# orca-ade — ARCHIVED (Experimental Spike)

**Status**: Experimental — superseded by Hermes ACP Integration initiative

## What Was Built (Sprint 3)

This directory contains an architecture spike for an Orca-like Agent Development Environment built for Hermes. It was developed under the incorrect assumption that we needed a Hermes-native Orca alternative.

### Preserved Concepts (Moved to `experimental/`)

| Concept | File | Value |
|---------|------|-------|
| **FanoutProtocol** | `experimental/src/fanout/index.ts` | Parallel & complementary mission fan-out with scope manifests |
| **MissionCompiler** | `experimental/src/mission/index.ts` | DAG validation, topological task grouping, scope compilation |
| **ScopeValidator** | `experimental/src/mission/index.ts` | Zero-overlap validation via ScopeManifest |
| **WorktreeManager** | `experimental/src/worktree/index.ts` | Basic create/allocate/release/delete/list/stats |
| **Types** | `experimental/src/types/index.ts` | Mission, Task, Worktree, FanoutStrategy, AgentAssignment, etc. |

These orchestration primitives are **preserved for reference** — they may inform the Hermes ACP adapter design but are not production code.

## Strategic Correction

> We do not want an Orca alternative.
> We want Hermes integrated into Orca.

**New Initiative**: `hermes-acp-integration` — Make Hermes a first-class ACP-compatible agent inside Orca.

- Orca handles: worktrees, terminals, diff review, browser/Design Mode, SSH, mobile
- Hermes provides: mission planning, portfolio governance, orchestration logic, model routing, execution intelligence

## Files

```
orca-ade/
├── README.md           # This file
├── docs-link.md        # Link to project documentation
├── package.json        # Package config (preserved)
├── tsconfig.json       # TypeScript config (preserved)
├── dist/               # Build output (preserved)
├── experimental/       # ARCHIVED SPIKE CODE
│   └── src/
│       ├── types/index.ts
│       ├── worktree/index.ts
│       ├── mission/index.ts
│       ├── fanout/index.ts
│       └── index.ts
└── node_modules/
```

## Specs (Unchanged)

Located in `~/hermes-master/05_DOCS/projects/orca-ade/`:
- `frs/FRS-022-orca-ade-v1.md` — Full FRS (reference only)
- `idd/IDD-022-orca-ade-v1.md` — Interface contracts
- `sdd/SDD-022-orca-ade-v1.md` — System design
- `adr/ORCA_ADOPTION_PLAN.md` — Orca subsystem adoption analysis