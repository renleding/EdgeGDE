#!/bin/bash
# Nightly Codebase Quality Scan
# Runs from EdgeGDE repo root. Detects regressions, creates kanban tasks on finding.
# Designed to complete in <3 minutes.

set -euo pipefail

REPO="/Users/warren/Documents/_HQ_AI/EdgeGDE"
cd "$REPO"

BASELINE_DIR=".hermes/baselines"
LOG_DIR=".hermes/logs/nightly-scan"
mkdir -p "$BASELINE_DIR" "$LOG_DIR"
DATE=$(date -u +%Y-%m-%d)
LOG="$LOG_DIR/$DATE.json"
PASS=true
FINDINGS=()

log_finding() {
  local severity="$1"  # P0-P4
  local category="$2"
  local message="$3"
  FINDINGS+=("{\"severity\":\"$severity\",\"category\":\"$category\",\"message\":\"$message\"}")
}

echo "=== EdgeGDE Nightly Scan: $DATE ==="

# ── 1. TypeScript Errors ──
echo "--- 1. Typecheck ---"
TS_ERRORS=$(cd apps/edge-runtime && npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
echo "TypeScript errors: $TS_ERRORS"
PREV_TS=$(cat "$BASELINE_DIR/typecheck.json" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('errors',0))" 2>/dev/null || echo "0")
if [ "$TS_ERRORS" -gt "$PREV_TS" ] 2>/dev/null; then
  log_finding "P1" "typecheck" "TypeScript errors increased: $PREV_TS → $TS_ERRORS"
  PASS=false
fi
echo "{\"errors\": $TS_ERRORS, \"date\": \"$DATE\"}" > "$BASELINE_DIR/typecheck.json"

# ── 2. Unit Tests ──
echo "--- 2. Unit Tests ---"
TEST_OUTPUT=$(cd apps/edge-runtime && bun run test:unit 2>&1 || true)
TEST_FAILS=$(echo "$TEST_OUTPUT" | grep -c "FAIL" || true)
TEST_PASS=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | tail -1 | grep -oE '[0-9]+' || echo "0")
echo "Tests: ${TEST_PASS} passed, ${TEST_FAILS} failed"
if [ "$TEST_FAILS" -gt 0 ]; then
  log_finding "P1" "tests" "$TEST_FAILS test(s) failing"
  PASS=false
fi

# ── 3. as any count ──
echo "--- 3. as any count ---"
AS_ANY=$(grep -rn "as any" apps/edge-runtime/src/ --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "as any: $AS_ANY"
PREV_ANY=$(cat "$BASELINE_DIR/as-any.json" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "0")
if [ "$AS_ANY" -gt "$PREV_ANY" ] 2>/dev/null; then
  INCREASE=$((AS_ANY - PREV_ANY))
  log_finding "P2" "typesafety" "as any increased by $INCREASE ($PREV_ANY → $AS_ANY)"
fi
echo "{\"count\": $AS_ANY, \"date\": \"$DATE\"}" > "$BASELINE_DIR/as-any.json"

# ── 4. console.log count ──
echo "--- 4. console.log count ---"
CONSOLE_LOG=$(grep -rn "console\.\(log\|warn\|error\)" apps/edge-runtime/src/ --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "console.log: $CONSOLE_LOG"
PREV_LOG=$(cat "$BASELINE_DIR/console-log.json" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "0")
if [ "$CONSOLE_LOG" -gt "$PREV_LOG" ] 2>/dev/null; then
  INCREASE=$((CONSOLE_LOG - PREV_LOG))
  log_finding "P2" "logging" "console.log increased by $INCREASE ($PREV_LOG → $CONSOLE_LOG)"
fi
echo "{\"count\": $CONSOLE_LOG, \"date\": \"$DATE\"}" > "$BASELINE_DIR/console-log.json"

# ── 5. Test file count (coverage proxy) ──
echo "--- 5. Test coverage ---"
SRC_FILES=$(find apps/edge-runtime/src -name '*.ts' -type f | wc -l | tr -d ' ')
TEST_FILES=$(find apps/edge-runtime/tests -name '*.ts' -type f | wc -l | tr -d ' ')
COVERAGE_PCT=$((TEST_FILES * 100 / SRC_FILES)) 2>/dev/null || echo "0"
echo "Source: $SRC_FILES, Tests: $TEST_FILES, Coverage: ${COVERAGE_PCT}%"
PREV_COV=$(cat "$BASELINE_DIR/coverage.json" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('pct',0))" 2>/dev/null || echo "0")
if [ "$COVERAGE_PCT" -lt "$PREV_COV" ] 2>/dev/null; then
  log_finding "P2" "coverage" "Test coverage dropped: ${PREV_COV}% → ${COVERAGE_PCT}%"
fi
echo "{\"pct\": $COVERAGE_PCT, \"src\": $SRC_FILES, \"tests\": $TEST_FILES, \"date\": \"$DATE\"}" > "$BASELINE_DIR/coverage.json"

# ── 6. Stale worktrees ──
echo "--- 6. Stale worktrees ---"
WORKTREES=$(git worktree list --porcelain 2>/dev/null | grep "^worktree" | wc -l | tr -d ' ')
STALE_WT=$(git worktree list 2>/dev/null | grep "locked" | wc -l | tr -d ' ')
echo "Active worktrees: $WORKTREES, Locked/stale: $STALE_WT"
if [ "$STALE_WT" -gt 0 ]; then
  log_finding "P3" "worktrees" "$STALE_WT locked/stale worktree(s) found"
fi

# ── 7. Migration drift ──
echo "--- 7. Migration drift ---"
SQL_FILES=$(ls apps/edge-runtime/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
REGISTERED=$(python3 -c "
import json
with open('apps/edge-runtime/wrangler.jsonc') as f:
    lines = [l for l in f if not l.strip().startswith('//')]
    cfg = json.loads(''.join(lines))
print(len(cfg.get('migrations', [])))
" 2>/dev/null || echo "0")
echo "SQL migrations: $SQL_FILES, Registered: $REGISTERED"
if [ "$SQL_FILES" -ne "$REGISTERED" ] 2>/dev/null; then
  UNREGISTERED=$((SQL_FILES - REGISTERED))
  log_finding "P2" "migrations" "$UNREGISTERED migration(s) unregistered (${SQL_FILES} files vs ${REGISTERED} registered)"
fi

# ── 8. Dependency audit ──
echo "--- 8. Dependency audit ---"
AUDIT_OUTPUT=$(cd apps/edge-runtime && bun audit 2>&1 || true)
AUDIT_COUNT=$(echo "$AUDIT_OUTPUT" | grep -c "vulnerability\|CVE\|high\|critical" || true)
if [ "$AUDIT_COUNT" -gt 0 ] 2>/dev/null; then
  log_finding "P0" "security" "$AUDIT_COUNT dependency vulnerability/ies found"
  PASS=false
fi

# ── Compile report ──
REPORT="{\"date\":\"$DATE\",\"pass\":$PASS,\"findings\":["
FIRST=true
for f in "${FINDINGS[@]}"; do
  if [ "$FIRST" = true ]; then
    REPORT+="$f"
    FIRST=false
  else
    REPORT+=",$f"
  fi
done
REPORT+="]}"
echo "$REPORT" > "$LOG"

echo ""
echo "=== Nightly Scan Complete ==="
echo "Pass: $PASS"
echo "Findings: ${#FINDINGS[@]}"
echo "Log: $LOG"

# Exit with findings count (0 = clean)
exit ${#FINDINGS[@]}
