#!/usr/bin/env bash
# EdgeGDE — Stale Worktree Cleanup CLI
# 
# Lists active git worktrees, shows age/dirty status, and optionally
# prunes stale ones (older than N days with no uncommitted changes).
#
# Usage:
#   bash scripts/cleanup-worktrees.sh          # list only
#   bash scripts/cleanup-worktrees.sh --dry-run # show what would be pruned
#   bash scripts/cleanup-worktrees.sh --prune   # prune stale worktrees
#   bash scripts/cleanup-worktrees.sh --prune --max-age 14  # prune if >14 days idle
#
set -euo pipefail

MAX_AGE="${MAX_AGE:-30}"  # default: prune after 30 days idle
MODE="${1:---list}"
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STALE_COUNT=0

# ── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --prune)    PRUNE=true ;;
    --dry-run)  DRY_RUN=true ;;
    --list)     LIST=true ;;
    --max-age=*) MAX_AGE="${arg#*=}" ;;
  esac
done

# Default: list mode
if [ -z "${PRUNE:-}" ] && [ -z "${DRY_RUN:-}" ] && [ -z "${LIST:-}" ]; then
  LIST=true
fi

echo "🔍 EdgeGDE Worktree Cleanup"
echo "   Base: $BASE_DIR"
if [ -n "${PRUNE:-}" ]; then echo "   Mode: PRUNE (stale > ${MAX_AGE}d)"; fi
if [ -n "${DRY_RUN:-}" ]; then echo "   Mode: DRY-RUN (no deletions)"; fi
echo ""

# ── Iterate worktrees ───────────────────────────────────────────────────────
cd "$BASE_DIR"

git worktree list --porcelain | while IFS= read -r line; do
  if [[ "$line" =~ ^worktree\ (.*) ]]; then
    WT_PATH="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^HEAD\ (.*) ]]; then
    HEAD_HASH="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^branch\ (.*) ]]; then
    BRANCH="${BASH_REMATCH[1]#refs/heads/}"
  elif [[ "$line" == "" ]]; then
    # Empty line = end of one worktree entry
    if [ -z "${WT_PATH:-}" ] || [ -z "${BRANCH:-}" ]; then continue; fi
    if [ "$WT_PATH" = "$BASE_DIR" ]; then continue; fi  # skip primary tree
    
    # ── Check age ─────────────────────────────────────────────────────────
    LAST_COMMIT=$(cd "$WT_PATH" && git log -1 --format=%ct 2>/dev/null || echo "0")
    NOW=$(date +%s)
    AGE_DAYS=$(( (NOW - LAST_COMMIT) / 86400 ))
    AGE_STR="${AGE_DAYS}d"
    
    # ── Check dirty ───────────────────────────────────────────────────────
    DIRTY=$(cd "$WT_PATH" && git status --porcelain 2>/dev/null | wc -l || echo "0")
    DIRTY_STR=""
    if [ "$DIRTY" -gt 0 ]; then
      DIRTY_STR=" ⚠ dirty"
    fi
    
    echo "  📂 $BRANCH"
    echo "     path: $WT_PATH"
    echo "     age:  ${AGE_STR}${DIRTY_STR}"
    
    # ── Prune stale ───────────────────────────────────────────────────────
    if [ -n "${PRUNE:-}" ] && [ "$AGE_DAYS" -gt "$MAX_AGE" ] && [ "$DIRTY" -eq 0 ]; then
      if [ -z "${DRY_RUN:-}" ]; then
        echo "     → pruning..."
        git worktree remove "$WT_PATH" 2>/dev/null || {
          echo "     → fallback: force-remove"
          git worktree remove --force "$WT_PATH" 2>/dev/null || true
          rm -rf "$WT_PATH" 2>/dev/null || true
        }
        git branch -D "$BRANCH" 2>/dev/null || true
        echo "     ✅ pruned"
        STALE_COUNT=$((STALE_COUNT + 1))
      else
        echo "     → would prune (dry-run)"
        STALE_COUNT=$((STALE_COUNT + 1))
      fi
    fi
    echo ""
    
    unset WT_PATH HEAD_HASH BRANCH
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏁 Done. ${STALE_COUNT} stale worktree(s) processed."
