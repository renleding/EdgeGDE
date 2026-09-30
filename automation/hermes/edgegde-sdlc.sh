#!/usr/bin/env bash
# edgegde-sdlc — Automated outer loop: push -> PR -> CI monitor -> merge -> deploy
set -euo pipefail

REPO_ROOT="/Users/warren/Documents/_HQ_AI/EdgeGDE"
WORKTREE_DIR="/Users/warren/Documents/_HQ_AI/EdgeGDE-worktrees"
AUTH_FILE="$HOME/.hermes/.edgegde-auth.json"
LOG_FILE="$HOME/.hermes/logs/edgegde-sdlc.log"
GH_REPO="renleding/EdgeGDE"
mkdir -p "$HOME/.hermes/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
err() { log "ERROR: $*"; exit 1; }

# ── Authorization model ───────────────────────────────────────────────────
# gogo = full authorization (push, PR, merge, deploy)
# deploy_block = explicit override: blocks deployment even when gogo is set
#
# Defaults: gogo=false, deploy_block=false
# gogo=true  → deploy_block CANNOT be true (gogo includes deploy)
# deploy_block=true  → blocks merge+deploy regardless of gogo state
# ──────────────────────────────────────────────────────────────────────────

init_auth() {
    if [ ! -f "$AUTH_FILE" ]; then
        echo '{"gogo": false, "deploy_block": false}' > "$AUTH_FILE"
    fi
}

get_auth() {
    init_auth
    python3 -c "import json; print(json.load(open('$AUTH_FILE')).get('$1', False))"
}

set_auth() {
    init_auth
    python3 -c "
import json
d = json.load(open('$AUTH_FILE'))
d['$1'] = $2
# gogo includes deploy — clear deploy_block when gogo is set
if '$1' == 'gogo' and $2 == True:
    d['deploy_block'] = False
json.dump(d, open('$AUTH_FILE', 'w'))
"
    log "Authorization $1 set to $2"
}

can_deploy() {
    # Deploy is allowed when: gogo=true AND deploy_block=false
    [ "$(get_auth "gogo")" = "True" ] && [ "$(get_auth "deploy_block")" = "False" ]
}

# ── Push + PR creation ────────────────────────────────────────────────────

cmd_push() {
    local name="$1"
    local branch="work/$name"
    log "Pushing $branch..."
    cd "$REPO_ROOT"

    # Create or find Kanban task for this work (on edgegde-core-dev board)
    local task_id=""
    task_id=$(hermes kanban --board edgegde-core-dev list 2>/dev/null | grep "$branch" | head -1 | awk '{print $2}' || echo "")
    if [ -z "$task_id" ]; then
        task_id=$(hermes kanban --board edgegde-core-dev create "work: $name" --body "Automated PR for $branch" 2>&1 | grep -o 't_[a-f0-9]*' | head -1 || echo "")
        if [ -n "$task_id" ]; then
            log "Created Kanban task $task_id on edgegde-core-dev board for branch $branch"
        fi
    else
        log "Found existing Kanban task $task_id for branch $branch"
    fi

    # Push the branch (create if doesn't exist on remote)
    git push origin "$branch":"$branch" 2>&1 || err "Push failed for $branch"
    log "Pushed $branch to origin"

    # Check if PR already exists
    local existing_pr
    existing_pr=$(gh pr list --head "$branch" --json number --jq '.[0].number' 2>/dev/null || echo "")

    if [ -n "$existing_pr" ]; then
        log "PR #$existing_pr already exists for $branch"
    else
        # Build PR body from commit log + diff stat
        local body
        body=$(python3 -c "
import subprocess
commits = subprocess.run(
    ['git', 'log', 'origin/main..$branch', '--oneline', '--no-decorate'],
    capture_output=True, text=True, cwd='$REPO_ROOT'
).stdout.strip()
diff_stat = subprocess.run(
    ['git', 'diff', 'origin/main..$branch', '--stat'],
    capture_output=True, text=True, cwd='$REPO_ROOT'
).stdout.strip()
print(f'## Commits\\n\\n{commits}\\n\\n## Files changed\\n\\n{diff_stat}')
")
        gh pr create \
            --repo "$GH_REPO" \
            --head "$branch" \
            --base main \
            --title "$name" \
            --body "$(printf '**Kanban:** %s\n\n%s\n\n---\n_Automated by edgegde-sdlc_' "${task_id:-t_auto}" "$body")" 2>&1 | tee -a "$LOG_FILE"
        log "Created PR for $branch"
    fi
}

# ── CI polling + merge ────────────────────────────────────────────────────

cmd_ci_poll() {
    init_auth
    cd "$REPO_ROOT"

    # SAFETY: this poller runs in a SHARED working tree that a human or an
    # interactive agent may be using concurrently. It must never leave that tree
    # on a different branch than it found it. History: the rebase path ran
    # `git checkout main` on the shared checkout, silently moving an interactive
    # session off its work/ branch — a subsequent commit then landed on main.
    local orig_branch
    orig_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

    gh pr list --state open --json number,headRefName,title --jq '.[] | "\(.number)|\(.headRefName)|\(.title)"' 2>/dev/null | while IFS='|' read -r pr_num head_ref pr_title; do
        log "Checking PR #$pr_num: $head_ref"

        # Get all check conclusions
        local ci_json
        ci_json=$(gh pr view "$pr_num" --json statusCheckRollup --jq '[.statusCheckRollup[]?.conclusion]' 2>/dev/null || echo "[]")

        local all_pass=true
        local any_fail=false
        local any_pending=false

        if echo "$ci_json" | python3 -c "
import sys, json
checks = json.load(sys.stdin)
if not checks:
    sys.exit(2)
for c in checks:
    if c in ('FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE'):
        sys.exit(1)
    if c in ('PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING'):
        sys.exit(3)
sys.exit(0)
" 2>/dev/null; then
            :  # all passed
        elif [ $? -eq 1 ]; then
            any_fail=true; all_pass=false
        elif [ $? -eq 3 ]; then
            any_pending=true; all_pass=false
        else
            all_pass=false
        fi

        if [ "$any_fail" = true ]; then
            log "  CI FAILED for #$pr_num ($head_ref)"
            gh pr edit "$pr_num" --add-label "ci-failed" 2>/dev/null || true
            continue
        fi
        if [ "$any_pending" = true ]; then
            log "  CI pending for #$pr_num ($head_ref)"
            continue
        fi
        if [ "$all_pass" = true ]; then
            log "  CI passed for #$pr_num ($head_ref)"
            gh pr edit "$pr_num" --remove-label "ci-failed" 2>/dev/null || true

            # Merge protocol: freshen before 5 commits gap, resolve conflicts autonomously
            local behind_count=0
            behind_count=$(git rev-list --count "origin/main..$head_ref" 2>/dev/null || echo "0")
            local ahead_count=0
            ahead_count=$(git rev-list --count "$head_ref..origin/main" 2>/dev/null || echo "0")

            if [ "$behind_count" -ge 5 ]; then
                log "  Branch $head_ref is $behind_count commits behind main — freshening"
                git checkout "$head_ref" 2>/dev/null || true
                if git rebase origin/main 2>&1; then
                    git push origin "$head_ref" --force-with-lease 2>&1 || true
                    log "  Rebased $head_ref onto latest main"
                else
                    log "  Rebase conflict on $head_ref — attempting auto-resolve"
                    # Try auto-resolve via git rerere or fall back to marking conflict
                    git rebase --abort 2>/dev/null || true
                    log "  Cannot auto-resolve conflicts for #$pr_num — escalating"
                    gh pr edit "$pr_num" --add-label "needs-rebase" 2>/dev/null || true
                    continue
                fi
                git checkout main 2>/dev/null || true
                git checkout "$orig_branch" 2>/dev/null || true
            fi

            # Also update PR body with freshened diff
            local behind_note=""
            [ "$behind_count" -gt 0 ] && behind_note=" (${behind_count} behind main)"

            if can_deploy; then
                log "  gogo includes deploy — merging #$pr_num ($head_ref${behind_note})"
                # NOTE: deliberately NOT `--delete-branch`. That flag deletes the
                # LOCAL branch and switches this SHARED working tree to the base
                # branch as a side effect. If an interactive session is sitting on
                # the head branch it is silently yanked onto main AND its branch is
                # deleted, so the restore guard below cannot recover it and a
                # follow-up commit lands directly on main. The remote ref is
                # retired explicitly after a confirmed merge instead.
                if gh pr merge "$pr_num" --squash 2>&1; then
                    log "  Merged #$pr_num ($head_ref)"
                    local wt_name="${head_ref#work/}"
                    if [ -d "$WORKTREE_DIR/work-$wt_name" ]; then
                        cd "$REPO_ROOT"
                        git worktree remove "$WORKTREE_DIR/work-$wt_name" --force 2>/dev/null || true
                        log "  Cleaned up worktree work-$wt_name"
                    fi
                    # Remote-only branch retirement. Touches no local ref, so the
                    # shared tree is never moved. Non-fatal if it fails.
                    if git push origin --delete "$head_ref" >>"$LOG_FILE" 2>&1; then
                        log "  Retired remote branch $head_ref"
                    else
                        log "  Could not retire remote branch $head_ref (non-fatal)"
                    fi
                else
                    log "  Merge failed for #$pr_num"
                fi
            else
                log "  deploy_block active — PR #$pr_num NOT auto-merged"
            fi
        fi
    done

    # SAFETY (shared worktree) — second failure mode, distinct from the rebase
    # path above. `gh pr merge --delete-branch` deletes the local branch that is
    # CURRENTLY CHECKED OUT, then switches the shared tree to the base branch
    # (`checkout main` + `pull --ff-only origin main`). When the poller merges a
    # PR whose head branch an interactive session is sitting on, that session is
    # silently yanked onto main and its branch is deleted — a follow-up commit
    # then lands and pushes directly to main, bypassing PR + CI.
    #
    # FIXED 2026-09-30: the `--delete-branch` flag was retired from the merge call
    # (see above); only the remote ref is now retired, after a confirmed merge. The
    # local branch and this tree therefore survive, making the guard below a true
    # backstop rather than a best-effort log line.
    # History: FRS-010 (#117/#118) 2026-09-29; SDD-010 v1.2 2026-09-30 (3rd occurrence).
    local cur_branch
    cur_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ -n "$orig_branch" ] && [ "$cur_branch" != "$orig_branch" ]; then
        if git show-ref --verify --quiet "refs/heads/$orig_branch"; then
            git checkout "$orig_branch" 2>/dev/null \
                && log "  Shared tree restored to $orig_branch (was left on $cur_branch)"
        else
            log "  WARNING: shared tree left on $cur_branch — original branch '$orig_branch' no longer exists"
            log "  ACTION REQUIRED: a commit made now lands on $cur_branch, not a work branch. Re-create the branch from origin/main before committing."
        fi
    fi
}

# ── Status ────────────────────────────────────────────────────────────────

cmd_status() {
    init_auth
    echo "Authorization gates:"
    echo "  gogo:          $(get_auth gogo)  (includes deploy when true)"
    echo "  deploy_block:  $(get_auth deploy_block)"
    echo "  can deploy:    $(can_deploy && echo yes || echo no)"
    echo ""
    echo "Open PRs:"
    cd "$REPO_ROOT" 2>/dev/null && gh pr list --state open --json number,headRefName,title \
        --jq '.[] | "  #\(.number) \(.headRefName) — \(.title)"' 2>/dev/null || echo "  (none)"
    echo ""
    echo "Worktrees:"
    cd "$REPO_ROOT" 2>/dev/null && git worktree list 2>/dev/null | sed 's/^/  /' || echo "  (not a git repo)"
}

# ── Main dispatch ──

init_auth

case "${1:-help}" in
    push)
        [ -n "${2:-}" ] || err "Usage: edgegde-sdlc push <worktree-name>"
        [ "$(get_auth gogo)" = "True" ] || err "gogo not authorized. Run: edgegde-sdlc authorize gogo on"
        cmd_push "$2"
        ;;
    pr)
        [ -n "${2:-}" ] || err "Usage: edgegde-sdlc pr <worktree-name>"
        cmd_push "$2"
        ;;
    ci-poll)
        cmd_ci_poll
        ;;
    status)
        cmd_status
        ;;
    authorize)
        [ -n "${2:-}" ] || err "Usage: edgegde-sdlc authorize <gogo|nodeploy> <on|off>"
        gate=""
        case "$2" in
            gogo) gate="gogo" ;;
            nodeploy) gate="deploy_block" ;;
            *) err "Unknown gate: $2 (use: gogo or nodeploy)" ;;
        esac
        case "${3:-}" in
            on|true|yes|1) set_auth "$gate" True ;;
            off|false|no|0) set_auth "$gate" False ;;
            *) err "Usage: edgegde-sdlc authorize <gogo|nodeploy> <on|off>" ;;
        esac
        ;;
    *)
        echo "Usage: edgegde-sdlc <command> [args]"
        echo ""
        echo "Authorization model:"
        echo "  gogo includes deploy approval by default."
        echo "  Use 'nodeploy' to block deployment explicitly."
        echo ""
        echo "Commands:"
        echo "  push <name>          Push worktree branch + create/update PR"
        echo "                       (requires gogo authorization)"
        echo "  pr <name>            Create/update PR without gogo check"
        echo "  ci-poll              Poll open PRs, merge if CI passes + gogo"
        echo "  status               Show auth gates, PRs, and worktrees"
        echo "  authorize <gate> <on|off>  Set gogo or nodeploy"
        echo ""
        echo "Quick start:"
        echo "  edgegde-sdlc authorize gogo on     # Enable everything (push+PR+deploy)"
        echo "  edgegde-sdlc authorize nodeploy on # Block deploy (override)"
        echo "  edgegde-sdlc push telemetry-v1     # Push + create PR"
        echo "  edgegde-sdlc ci-poll               # Check CI, merge ready PRs"
        ;;
esac
