#!/usr/bin/env bash
# Preflight gate for EdgeGDE agent sessions.
#
# WHY THIS EXISTS
# ---------------
# Two failures motivated it, both costs rather than judgement calls:
#
#   1. A session was run against a stale `main` (18 commits behind). Work was
#      built on top of a base that had already solved the same problems, so the
#      effort produced a duplicate of shipped code — and an unrelated outage was
#      caused chasing a defect that upstream had already fixed and documented.
#
#   2. `git stash clear` was run on a shared checkout holding uncommitted work.
#      The work was recoverable only via `git fsck --lost-found`.
#
# Both are detectable in seconds, before any work starts. The gate is therefore
# a refusal, not a warning: it exits non-zero so a session that ignores it is
# visibly broken rather than quietly wrong.
#
# USAGE
#   tools/preflight.sh            # check; exit 1 if unsafe to proceed
#   tools/preflight.sh --strict   # also refuse on uncommitted changes (default)
#   tools/preflight.sh --allow-dirty   # permit uncommitted changes (they are
#                                      still snapshotted and reported)
#
# This script never mutates the working tree. It reads and reports only.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)

STRICT=1
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) STRICT=0 ;;
    --strict)      STRICT=1 ;;
    -h|--help)     sed -n '2,25p' "$0"; exit 0 ;;
  esac
done

FAILURES=0
WARNINGS=0
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo "  WARN  $1"; WARNINGS=$((WARNINGS + 1)); }
ok()   { echo "  ok    $1"; }

echo "EdgeGDE preflight — $(date '+%Y-%m-%d %H:%M:%S')"
echo

# --- 1. Is this a git repo we can reason about? ------------------------------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "not a git repository — cannot determine base state"
  echo; echo "preflight: FAILED (${FAILURES} failures)"; exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'DETACHED')
echo "branch: ${BRANCH}"

# --- 2. Fetch, then check we are not behind the base -------------------------
# A stale base is the silent failure: everything works, the work is simply
# built on the wrong foundation. Fetch first so the comparison is against
# reality, not a stale remote-tracking ref.
if git fetch --quiet origin 2>/dev/null; then
  ok "fetched origin"
else
  warn "could not fetch origin (offline?) — staleness check is against cached refs"
fi

if git rev-parse --verify --quiet origin/main >/dev/null; then
  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  MERGE_BASE=$(git merge-base HEAD origin/main 2>/dev/null || true)

  if [ "${BEHIND}" -gt 0 ]; then
    # Diverged (local commits too) is worse than merely behind: a naive
    # `git merge` here can reintroduce conflicts that were already resolved
    # upstream. Distinguish the two so the remedy is obvious.
    if [ "${AHEAD}" -gt 0 ]; then
      fail "diverged from origin/main: ${AHEAD} ahead, ${BEHIND} behind"
      echo "        → local commits exist; rebase onto origin/main before working."
      echo "        → if your commits duplicate upstream, verify by content first:"
      echo "          git log origin/main --oneline --grep='<your commit subject>'"
    else
      fail "behind origin/main by ${BEHIND} commit(s)"
      echo "        → run: git pull --ff-only   (then re-run this gate)"
    fi
  else
    ok "in sync with origin/main (ahead ${AHEAD}, behind ${BEHIND})"
  fi

  # Uncommitted changes are legitimate, but they must be a conscious choice:
  # a shared checkout may hold another session's work.
  DIRTY=$(git status --porcelain 2>/dev/null | grep -v '^??' | wc -l | tr -d ' ')
  UNTRACKED=$(git status --porcelain 2>/dev/null | grep -c '^??' | tr -d ' ')
  if [ "${DIRTY}" -gt 0 ] || [ "${UNTRACKED}" -gt 0 ]; then
    msg="working tree modified: ${DIRTY} tracked, ${UNTRACKED} untracked"
    if [ "${STRICT}" -eq 1 ]; then
      # Refuse by default. The destructive operations that follow (branch
      # switching, merges, resets) can silently discard this work — the exact
      # loss this gate exists to prevent.
      fail "${msg}"
      echo "        → commit, stash WITH A NAME, or re-run with --allow-dirty."
      echo "        → NEVER run 'git stash clear' on this checkout."
    else
      warn "${msg} (allowed by --allow-dirty; do not run destructive git)"
    fi
    echo "        → snapshot before any destructive operation:"
    echo "          tools/preflight.sh --snapshot"
  else
    ok "working tree clean"
  fi
else
  warn "origin/main not found — cannot check base staleness"
fi

# --- 3. Duplicate-file detection --------------------------------------------
# A dead file with the same name as a live one invites edits to the wrong copy.
# This happened with governance-check.ts: the edited file was not the one CI
# runs. Real duplicates are rare, so a warning is proportionate; silent
# confusion is not.
DUPES=0
while IFS= read -r name; do
  [ -z "${name}" ] && continue
  paths=$(git ls-files -- "*/${name}" "${name}" 2>/dev/null | grep -v node_modules | grep -v '\.venv')
  count=$(echo "${paths}" | grep -c . || true)
  if [ "${count}" -gt 1 ]; then
    # Same basename under different roots — only interesting for executables
    # and config, where "which one runs" is genuinely ambiguous.
    case "${name}" in
      *.ts|*.sh|*.py|*.json|*.yml|*.yaml)
        # Skip test files: mirrored test paths are conventional, not confusing.
        case "${name}" in *test*|*spec*) continue ;; esac
        DUPES=$((DUPES + 1))
        warn "duplicate basename '${name}' in ${count} locations:"
        echo "${paths}" | sed 's/^/          /'
        ;;
    esac
  fi
done < <(git ls-files 2>/dev/null | grep -v node_modules | grep -v '\.venv' | xargs -n1 basename 2>/dev/null | sort | uniq -d)

[ "${DUPES}" -eq 0 ] && ok "no ambiguous duplicate basenames"

# --- 4. Destructive-operation awareness -------------------------------------
# Report whether the operations that caused past incidents are currently
# reachable, so the operator sees them before, not after.
if ls .git/worktrees/*/ 2>/dev/null | head -1 >/dev/null; then
  WT=$(ls -d .git/worktrees/*/ 2>/dev/null | wc -l | tr -d ' ')
  warn "shared checkout: ${WT} linked worktree(s) exist"
  echo "        → other agents may hold uncommitted work here. Never run"
  echo "          'git stash clear', 'git reset --hard', or 'git clean -fd'"
  echo "          without checking 'git stash list' and 'git status' first."
fi

echo
if [ "${FAILURES}" -gt 0 ]; then
  echo "preflight: FAILED (${FAILURES} failure(s), ${WARNINGS} warning(s))"
  echo
  echo "Do not begin work until the failures above are resolved. Each one"
  echo "corresponds to a failure that has actually occurred before."
  # A snapshot must still be taken on this path: a dirty tree is precisely the
  # situation that warrants one, and it is also what triggers the failure.
  SNAPSHOT_REQUESTED=1
  SNAPSHOT_RC=1
else
  if [ "${WARNINGS}" -gt 0 ]; then
    echo "preflight: PASSED with ${WARNINGS} warning(s)"
  else
    echo "preflight: PASSED"
  fi
  SNAPSHOT_REQUESTED=0
  SNAPSHOT_RC=0
fi

# --- Optional: snapshot mode ------------------------------------------------
# Invoked as '--snapshot': capture the current tree before a risky step. Runs on
# BOTH the pass and fail paths, because the risky step may be a repair.
if [ "${1:-}" = "--snapshot" ]; then
  SNAP_DIR=".hermes/checkpoints/preflight-$(date '+%Y%m%d-%H%M%S')"
  mkdir -p "${SNAP_DIR}"
  git diff > "${SNAP_DIR}/tracked.patch" 2>/dev/null || true
  git status --porcelain > "${SNAP_DIR}/status.txt" 2>/dev/null || true
  # Untracked files are not in the patch, so record them explicitly — the
  # earlier data loss was of files that no patch would have captured.
  git ls-files --others --exclude-standard > "${SNAP_DIR}/untracked.txt" 2>/dev/null || true
  echo
  echo "snapshot written: ${SNAP_DIR}"
  echo "  tracked.patch  — recover tracked changes with 'git apply'"
  echo "  status.txt     — exact list of affected paths"
  echo "  untracked.txt  — files a patch cannot recover; back these up directly"
fi

if [ "${SNAPSHOT_REQUESTED}" = "1" ]; then exit 1; fi
exit 0
