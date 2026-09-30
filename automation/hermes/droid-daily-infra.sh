#!/bin/bash
# droid-daily-infra.sh — deterministic infrastructure health check for EdgeGDE
# Converted from LLM cron job 0e0077bf4088 (droid-daily-infra) to no_agent.
# Prints only issues found; prints [SILENT] when everything is healthy.
set -uo pipefail

ISSUES=0
REPO=/Users/warren/Documents/_HQ_AI/EdgeGDE

note() { echo "[$1] $2"; ISSUES=$((ISSUES+1)); }

# 1. DB MIGRATIONS CHECK
cd "$REPO" || { note HIGH "cannot cd to $REPO"; exit 1; }
LOCAL_MIGRATIONS=$(ls apps/edge-runtime/migrations/ 2>/dev/null | sort)
if [ -z "$LOCAL_MIGRATIONS" ]; then
  note MEDIUM "no migrations directory found"
else
  REMOTE_MIGRATIONS=$( (cd apps/edge-runtime && timeout 60 npx wrangler d1 migrations list edgegde-db 2>/dev/null) )
  if [ -z "$REMOTE_MIGRATIONS" ]; then
    : # wrangler unavailable/offline — skip silently rather than false-positive
  else
    # wrangler lists applied migrations; flag locals not mentioned as applied
    while IFS= read -r m; do
      [ -z "$m" ] && continue
      if ! echo "$REMOTE_MIGRATIONS" | grep -q "$(basename "$m" .sql)"; then
        note MEDIUM "migration possibly not applied: $m"
      fi
    done <<< "$LOCAL_MIGRATIONS"
  fi
fi

# 2. DISK USAGE
while read -r pct mount; do
  usepct=${pct%\%}
  if [ "$usepct" -ge 90 ] 2>/dev/null; then
    note HIGH "disk usage ${pct} on ${mount}"
  fi
done < <(df -h / | awk 'NR>1 {print $5, $9}')

# 3. STALE WORKTREES (>14 days, no recent activity)
for wt in "$REPO"/../EdgeGDE-worktrees/*/ "$REPO"/.worktrees/*/; do
  [ -d "$wt" ] || continue
  last_commit_ts=$(git -C "$wt" log -1 --format=%ct 2>/dev/null || echo 0)
  now=$(date +%s)
  age_days=$(( (now - last_commit_ts) / 86400 ))
  if [ "$age_days" -ge 14 ]; then
    dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    note LOW "stale worktree (${age_days}d, ${dirty} dirty files): $wt"
  fi
done

# 4. OLLAMA HEALTH
ollama_code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:11434/api/tags 2>/dev/null || echo 000)
if [ "$ollama_code" != "200" ]; then
  note MEDIUM "Ollama not reachable (http $ollama_code)"
fi

# 5. HERMES CRON HEALTH — flag errored jobs
cron_errs=$(hermes cron list 2>/dev/null | grep -c "error:" || true)
if [ "${cron_errs:-0}" -gt 0 ]; then
  err_names=$(hermes cron list 2>/dev/null | awk '/^  [0-9a-f]+ \[/{id=$1} /Name:/{name=$2} /error:/{print name}' | sort -u | tr '\n' ' ')
  note MEDIUM "$cron_errs errored cron run(s): $err_names"
fi

# 6. GIT HEALTH — uncommitted changes on EdgeGDE main
git_dirty=$(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "${git_dirty:-0}" -gt 0 ]; then
  note MEDIUM "EdgeGDE main has $git_dirty uncommitted changes"
fi
git -C "$REPO" fetch origin --quiet 2>/dev/null
behind=$(git -C "$REPO" rev-list --count main..origin/main 2>/dev/null || echo 0)
ahead=$(git -C "$REPO" rev-list --count origin/main..main 2>/dev/null || echo 0)
if [ "${behind:-0}" -gt 0 ]; then note MEDIUM "EdgeGDE main behind origin by $behind commits"; fi
if [ "${ahead:-0}" -gt 0 ]; then note LOW "EdgeGDE main ahead of origin by $ahead commits (unpushed)"; fi

# 7. MEMORY PRESSURE (free percentage; macOS keeps very few truly-free pages)
mem_free_pct=$(memory_pressure 2>/dev/null | grep -i "free percentage" | grep -o '[0-9]\+' | head -1)
if [ -n "$mem_free_pct" ] && [ "$mem_free_pct" -lt 10 ] 2>/dev/null; then
  note MEDIUM "low free memory: ${mem_free_pct}% free"
fi

if [ "$ISSUES" -eq 0 ]; then
  echo "[SILENT]"
else
  echo "droid-daily-infra: $ISSUES issue(s) found."
fi
