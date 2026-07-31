# OpenSpec Integration — EdgeGDE SDLC

## Install

```bash
npm install -g @fission-ai/openspec@latest
```

**Watch out:** The npm package `openspec` (v0.0.0, no code) is a different placeholder. Must use `@fission-ai/openspec`.

## Initialize in a repo

```bash
cd /path/to/repo
openspec init --tools none
```

This creates `openspec/config.yaml` with schema `spec-driven`.

## EdgeGDE-specific config

```yaml
schema: spec-driven
context: |
  Tech stack: TypeScript, Hono, Cloudflare Workers, D1, KV, R2, Durable Objects
  Runtime: Bun (local), Cloudflare Workers (prod)
  Tools: Chrome for Testing (CfT), CDP, Patchright/Playwright, pyautogui, Ollama
  Conventions: Conventional commits, EdgeGDE SDLC (5-phase state machine), AGENTS.md governance
  Automation: Salestrekker 2.0 React SPA, 4-tier sensory array (CDP→MCP→browser-act→Vision→CUA)
  AI: Hermes Agent (director), Aegis (governance), Droid (execution)
rules:
  proposal:
    - Keep proposals under 1000 words
    - Always include "Non-goals" and "Risks" sections
    - Reference FRS documents when applicable (docs/FRS-*.md)
  specs:
    - Each spec must have verifiable acceptance criteria with numbered scenarios
    - Include both success and failure paths
  tasks:
    - Each task maps to one kanban card
    - Reference the FRS number in task descriptions
```

## Workflow

1. `openspec new change "<name>"` — creates `openspec/changes/<name>/` with artifacts
2. Write `proposal.md` — WHY this change, WHAT changes, capabilities list
3. Write `design.md` — architecture, data flow, file structure
4. Write specs in `specs/<capability>/spec.md` — `## ADDED Requirements` with `#### Scenario:` blocks
5. Write `tasks.md` — implementation tasks
6. `openspec validate <name>` — must pass before implementation begins
7. `openspec archive <name>` — on completion, moves to archive

## OpenSpec file structure

```
openspec/
  config.yaml            # Project context + rules
  specs/                 # Main (live) specs
  changes/<name>/        # In-flight change
    proposal.md
    design.md
    specs/<cap>/spec.md  # Delta specs (capability folders)
    tasks.md
  changes/archive/       # Completed changes
```

## Spec Format Requirements (from `openspec validate` errors)

**Every `### Requirement:` line MUST be followed by a sentence containing "SHALL" or "MUST".**

```markdown
### Requirement: First state capture returns all three layers

The state cache SHALL capture DOM, AX tree, and screenshot in a single call on first access.

#### Scenario: Initial capture
Given a page at URL
When `mcp_state()` is called
Then the response includes `dom`, `ax_tree`, and `screenshot` fields
```

**Every requirement MUST have at least one `#### Scenario:` block** with Given/When/Then structure.

**Spec files MUST be in capability folders** — `specs/<kebab-name>/spec.md`, NOT `specs/flat-file.md`.

**Headers MUST use capitalized keywords:** `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, `## RENAMED Requirements`.

### Common validation errors

| Error | Fix |
|-------|-----|
| `must contain SHALL or MUST` | Add a sentence with "SHALL" or "MUST" between `### Requirement:` and the first `#### Scenario:` |
| `is missing requirement text` | Add description text between requirement header and first scenario |
| `No deltas found` | Spec files must be in `specs/<capability>/spec.md` (capability subdirectories) |
| `No tools detected` | Use `--tools none` for Hermes-based repos |

## CI Gate

Add to `.github/workflows/ci.yml`:

```yaml
- name: Validate OpenSpec changes
  run: openspec validate
```

Fails PR if any active change has invalid spec format.

## Hermes Instructions Integration

The OpenSpec workflow is documented in two system-level files:

- `SOUL.md` — "Spec-Driven Development (OpenSpec)" section: full workflow, artifact structure, spec requirements
- `instructions.md` — Section 14: OpenSpec workflow, spec requirements, config location

Both live at `~/.hermes/` and are injected as system context on every session.
