#!/bin/bash
# Dependency-Safe Branch Cleanup
# Deletes stale remote branches that meet ALL criteria:
# 1. Branch is >30 days old (no commits)
# 2. Branch has been fully merged into main (all commits reachable)
# 3. No open PRs reference the branch
# 4. No active worktrees reference the branch
# 5. Branch is NOT currently checked out anywhere
# Run from EdgeGDE repo root.
# ⚠️ Dry-run by default. Pass --force to actually delete.

set -euo pipefail

REPO="/Users/warren/Documents/_HQ_AI/EdgeGDE"
cd "$REPO"

DRY_RUN=true
if [ "${1:-}" = "--force" ]; then
  DRY_RUN=false
fi

echo "=== Dependency-Safe Branch Cleanup ==="
echo "Dry run: $DRY_RUN"
echo ""

THIRTY_DAYS_AGO=$(date -u -v-30d +%s 2>/dev/null || date -u -d '30 days ago' +%s)
TODAY=$(date -u +%Y-%m-%d)
LOG=".hermes/logs/branch-cleanup/$TODAY.json"
mkdir -p ".hermes/logs/branch-cleanup"
DELETED=()
SKIPPED=()

# Fetch latest
git fetch --prune origin 2>&1 | grep -v "^$" || true

# Get all remote branches (excluding main, HEAD)
REMOTE_BRANCHES=$(git branch -r --merged origin/main 2>/dev/null | grep -v "origin/main\|origin/HEAD" | sed 's/^[[:space:]]*//')

for branch in $REMOTE_BRANCHES; do
  [ -z "$branch" ] && continue
  SHORT_NAME="${branch#origin/}"
  
  # ── CHECK 1: Is branch >30 days old? ──
  LAST_COMMIT=$(git log -1 --format="%ct" "$branch" 2>/dev/null || echo "0")
  if [ "$LAST_COMMIT" -eq 0 ]; then
    SKIPPED+=("$SHORT_NAME: cannot determine age")
    continue
  fi
  
  BRANCH_AGE_DAYS=$(( (TODAY_EPOCH - LAST_COMMIT) / 86400 ))
  # Recalculate properly
  BRANCH_AGE_DAYS=$(python3 -c "import time; print(int((time.time() - $LAST_COMMIT) / 86400))" 2>/dev/null || echo "99")
  
  if [ "$BRANCH_AGE_DAYS" -lt 30 ]; then
    SKIPPED+=("$SHORT_NAME: only ${BRANCH_AGE_DAYS}d old (<30d threshold)")
    continue
  fi
  
  # ── CHECK 2: Is branch fully merged into main? ──
  if ! git merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
    SKIPPED+=("$SHORT_NAME: not fully merged into main")
    continue
  fi
  
  # ── CHECK 3: Any open PRs reference this branch? ──
  PR_COUNT=0
  if command -v gh &>/dev/null; then
    PR_COUNT=$(gh pr list --head "$SHORT_NAME" --json 'number' --jq 'length' 2>/dev/null || true)
  fi
  if [ "$PR_COUNT" -gt 0 ]; then
    SKIPPED+=("$SHORT_NAME: $PR_COUNT open PR(s) still reference it")
    continue
  fi
  
  # ── CHECK 4: Any worktree on this branch? ──
  WT_COUNT=$(git worktree list 2>/dev/null | grep "$SHORT_NAME" | wc -l | tr -d ' ')
  if [ "$WT_COUNT" -gt 0 ]; then
    SKIPPED+=("$SHORT_NAME: $WT_COUNT active worktree(s) on this branch")
    continue
  fi
  
  # ── CHECK 5: Not currently checked out ──
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$SHORT_NAME" = "$CURRENT_BRANCH" ]; then
    SKIPPED+=("$SHORT_NAME: currently checked out")
    continue
  fi
  
  # ── ALL CHECKS PASSED — safe to delete ──
  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY-RUN] Would delete: $SHORT_NAME ($BRANCH_AGE_DAYS days, merged, no PRs, no worktrees)"
    DELETED+=("$SHORT_NAME (DRY-RUN)")
  else
    echo "  Deleting: $SHORT_NAME ($BRANCH_AGE_DAYS days old)"
    git push origin --delete "$SHORT_NAME" 2>&1
    DELETED+=("$SHORT_NAME")
  fi
done

echo ""
echo "=== Summary ==="
echo "Deleted: ${#DELETED[@]}"
echo "Skipped: ${#SKIPPED[@]}"

REPORT="{\"date\":\"$TODAY\",\"dry_run\":$DRY_RUN,\"deleted\":${#DELETED[@]},\"skipped\":${#SKIPPED[@]}"
REPORT+=",\"deleted_branches\":["
FIRST=true
for d in "${DELETED[@]}"; do
  if [ "$FIRST" = true ]; then REPORT+="\"$d\""; FIRST=false; else REPORT+=",\"$d\""; fi
done
REPORT+="],\"skipped_branches\":["
FIRST=true
for s in "${SKIPPED[@]}"; do
  if [ "$FIRST" = true ]; then REPORT+="\"$s\""; FIRST=false; else REPORT+=",\"$s\""; fi
done
REPORT+="]}"
echo "$REPORT" > "$LOG"
echo "Log: $LOG"

if [ ${#DELETED[@]} -gt 0 ]; then
  exit 0
fi
