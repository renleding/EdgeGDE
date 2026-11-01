# agent-runtime (Package)

> **Status:** Planned
> **Docs:** [Project Documentation](../../../../hermes-master/05_DOCS/projects/agent-runtime/)

## Overview

This is the shared package scaffold for **agent-runtime** — the core runtime library consumed by the Droid CLI and Hermes Director.

## Structure

```
agent-runtime/
├── README.md          # This file
├── docs-link.md       # Link to project documentation
├── src/               # Shared library source (to be added)
└── package.json       # Deferred until runtime/language chosen
```

## Exports

The package will export:
- `ManifestValidator` — validate Mission Manifests
- `GovernanceGate` — pre-mutation governance
- `VerificationRunner` — execute verification criteria
- `DroidEngine` — execute missions
- `CheckpointManager` — checkpoint/restore
- `SagaEngine` — compensation execution
- `ActionJournal` — structured logging
- `CodeValidateLoop` — autonomous write→verify→adjust
- `ParallelCoordinator` — worktree management
- Types: `MissionManifest`, `Task`, `VerificationCriteria`, `ExecutionReport`, etc.

## Status

- **Package:** Planned (scaffolded)
- **App:** Planned (scaffolded)
- **OpenSpec:** No
- **Owner:** Unassigned

---

*Generated from portfolio manifest*
