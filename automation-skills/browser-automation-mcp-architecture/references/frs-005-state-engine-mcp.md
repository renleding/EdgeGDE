# FRS-005: State Engine MCP — Reference (v1.1)

Full specification: `docs/FRS-005-state-engine-mcp-v1.md`

## Core Architecture

```
Hermes
   │
   ▼
State Engine MCP (localhost:9110)
   │
   ├─ State Cache          (DOM + AX + screenshot, lazy refresh, Dirty/DirtyCritical tiers)
   ├─ Resolver             (text → role → AX → visual cascade, container scoping)
   ├─ Action Engine        (wraps SensoryArray escalation, 4 tiers)
   ├─ State Diff Engine    (structured before/after comparison, not raw DOM)
   ├─ Verification Engine  (rules-based success detection per action type)
   └─ Failure Envelope     (structured error with page context for LLM diagnosis)
         │
         ▼
   Chromium (CfT, CDP port 9222)
```

## MCP Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `mcp_state()` | Page situational awareness | `{url, title, dialog, buttons, errors}` |
| `mcp_interact(action, target, value)` | Execute action with auto-escalation | `{status, tier_used, state_diff}` |
| `mcp_inspect(target)` | Deep element metadata | `{role, label, visible, enabled, bbox}` |
| `mcp_screenshot()` | Visual debugging | Base64 PNG |
| `mcp_workflow(name, params)` | Deterministic multi-step execution | `{status, step_failed, results[]}` |

## Key Design Decisions from Reviews

### Resolver needs contextual targeting
Salestrekker has 7+ duplicate "Delete" buttons and 9+ "Add vehicle loan" buttons. Flat text matching fails. Need `container` parameter and proximity weighting. Tiebreakers: container match → proximity → index → visual.

### Cache uses Dirty/DirtyCritical tiers
React apps emit constant DOM mutations (hover effects, animation frames, keystroke side-effects). Full cache rebuild on every mutation would waste CPU. Two-tier flag: minor mutations → `Dirty` (rebuild DOM summary only), structural changes → `DirtyCritical` (rebuild all layers).

### Action Journal is mandatory for debugging
Every action logged as JSON-Lines to `~/.hermes/logs/state-engine/actions.jsonl`. Tier success rates tracked per action type. Auto-tuning: skip tiers that fail >30% of the time.

### Workflow Engine is deterministic, not AI
`mcp_workflow()` runs predefined YAML workflows. No LLM involvement in step sequencing. Failures return `workflow_step` for Hermes to diagnose.

## Build Phases & Effort

| Phase | FRs | Components | Effort |
|-------|-----|-----------|--------|
| 1 | FR-1, FR-2, FR-5, FR-6 | CDP connection manager, State Cache, State Diff, Verification Engine | 1.5d |
| 2 | FR-3, FR-4 | Cascade Resolver, Action Engine (wraps SensoryArray) | 1.5d |
| 3 | FR-7, FR-8, FR-9, FR-10, FR-11 | FastMCP server, MCP tools, Workflow Engine, Action Journal, Salestrekker rules | 1.5d |
| 4 | All (integration) | Full asset form end-to-end test, reliability measurement | 1d |

## Salestrekker-Specific Rules (FR-9)

- Save button: `[role="button"][name="Save and calculate"]` via AX
- Radix combobox: use keyboard events (ArrowDown → Enter), CDP mouse events don't trigger onChange
- Radix Add button: use `__reactProps$.onClick()` fallback — element.click() and CDP mouse events are blocked by Radix portal
- "Client profile successfully updated" appearing WITHOUT data persisting → treat as verification failure (known Salestrekker bug)

## Failure Envelope Shape

```json
{
  "status": "failed",
  "action": "click",
  "target": "Save",
  "tiers_attempted": [{"tier": "AX", "error": "element_not_found"}],
  "verification": {"verified": false, "reason": "no_state_change"},
  "state": {"errors": ["Vehicle type is required"]}
}
```
