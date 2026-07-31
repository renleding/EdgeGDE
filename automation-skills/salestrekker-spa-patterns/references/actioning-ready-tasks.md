# Actioning Ready Kanban Tasks — Direct Execution Protocol

**Rule:** When the user says "action kanban ready tasks" or "process kanban suggestions",
execute them DIRECTLY. Do NOT run automation pipelines.

## Correct Flow

1. `hermes kanban list | grep '▶.*ready'` — identify ready tasks
2. `hermes kanban claim <id>` — claim each actionable task
3. Execute the fix directly
4. `hermes kanban complete <id>` — mark done with summary
5. Report what was accomplished

## What NOT to Do

- ❌ `hermes kanban dispatch` — silently skips manual tasks as nonspawnable
- ❌ `improvement_loop.py` / `improvement_patch.py` — not for on-demand kanban
- ❌ System sweep — too broad
- ❌ Report without executing fixable tasks first

The dispatch/sweep pipelines are for cron-based autonomous runs,
not on-demand kanban processing. Direct execution was the user's
corrected preference (2026-07-26).
