#!/bin/bash
# Continuous improvement loop for EdgeGDE (no_agent cron).
# Converted from LLM-driven job on 2026-08-23 sweep: the agent wrapper only
# ran two deterministic commands and reported output — no reasoning value.
set -uo pipefail
cd /Users/warren/Documents/_HQ_AI/EdgeGDE || { echo "FATAL: EdgeGDE repo not found"; exit 1; }

echo "=== improvement_loop run --days 7 ==="
python3 tools/improvement_loop.py run --days 7 2>&1
IL_EXIT=$?

echo ""
echo "=== chores_to_workflows run ==="
python3 tools/chores_to_workflows.py run 2>&1
CW_EXIT=$?

echo ""
echo "=== summary: improvement_loop exit=$IL_EXIT chores_to_workflows exit=$CW_EXIT ==="
# Exit nonzero only if BOTH failed (partial results still worth reporting).
if [ "$IL_EXIT" -ne 0 ] && [ "$CW_EXIT" -ne 0 ]; then
  exit 1
fi
exit 0
