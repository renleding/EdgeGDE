#!/usr/bin/env bash
# EdgeGDE Self-Healing Watchdog
# Automatically detects and fixes common config drift
# Runs silently unless something was actually fixed
set -euo pipefail

LOG_FILE="$HOME/.hermes/logs/self-heal.log"
AUTH_FILE="$HOME/.hermes/.edgegde-auth.json"
FIXED=false

mkdir -p "$HOME/.hermes/logs"

# ── 1. Normalize auth file — strip orphan keys ──────────────────────────
if [ -f "$AUTH_FILE" ]; then
  VALID_KEYS=$(python3 -c "
import json
with open('$AUTH_FILE') as f:
    d = json.load(f)
expected = {'gogo', 'deploy_block'}
actual = set(d.keys())
extra = actual - expected
if extra:
    d = {k: d[k] for k in expected if k in d}
    with open('$AUTH_FILE', 'w') as f:
        json.dump(d, f)
    print('STRIPPED: ' + ', '.join(sorted(extra)))
else:
    print('CLEAN')
" 2>&1)

  if [ "$VALID_KEYS" != "CLEAN" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Auth file: $VALID_KEYS" >> "$LOG_FILE"
    FIXED=true
  fi
fi

# ── 2. Verify auth file is valid JSON ───────────────────────────────────
if [ -f "$AUTH_FILE" ]; then
  if ! python3 -c "import json; json.load(open('$AUTH_FILE'))" 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Auth file is corrupt — reinitializing" >> "$LOG_FILE"
    echo '{"gogo": false, "deploy_block": false}' > "$AUTH_FILE"
    FIXED=true
  fi
fi

# ── 3. Report if anything was fixed ─────────────────────────────────────
if [ "$FIXED" = true ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Self-heal: one or more issues fixed" >> "$LOG_FILE"
  echo "[SELF-HEAL] Config drift detected and fixed — see $LOG_FILE"
  exit 0
fi
# Silent exit — nothing to report
exit 0
