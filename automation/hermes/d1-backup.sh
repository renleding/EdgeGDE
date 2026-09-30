#!/bin/bash
# ═════════════════════════════════════════════════════════════════════════════
# D1 Database Backup — EdgeGDE
# Exports all D1 databases using the best available method:
#   1. `wrangler d1 export` for databases without FTS5 virtual tables
#   2. `wrangler d1 time-travel info` bookmark for databases with FTS5
# Both approaches are fully restorable via Cloudflare's D1 Time Travel.
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail

BACKUP_ROOT="/tmp/d1-backups"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LOG="$BACKUP_ROOT/backup-${DATE}.log"
WRANGLER_DIR="/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime"
# Pin to the local wrangler binary — avoids npx cache version drift (the
# 2026-08-01 failure: npx resolved a cached wrangler that crashed with
# "Exit prior to config file resolving / call config.load() before reading values").
WRANGLER="$WRANGLER_DIR/node_modules/.bin/wrangler"
if [ ! -x "$WRANGLER" ]; then
  WRANGLER="npx wrangler"
fi
FAILURES=0

# ── Database configuration ──────────────────────────────────────────────────
# Format: "database_name:description"
DATABASES=(
  "ebroker_leads:production"
  "ebroker_leads_staging:staging"
  "edgegde-prod:production"
)

mkdir -p "$BACKUP_ROOT"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== D1 Database Backup — $DATE ($TIMESTAMP) ==="

cd "$WRANGLER_DIR"

# ── Main export loop ───────────────────────────────────────────────────────
for entry in "${DATABASES[@]}"; do
  IFS=':' read -r db_name env <<< "$entry"
  SQL_FILE="$BACKUP_ROOT/${db_name}-${DATE}.sql"
  BOOKMARK_FILE="$BACKUP_ROOT/${db_name}-${DATE}.bookmark"
  log "Exporting ${db_name} (${env})..."

  # Strategy 1: Try standard SQL export first
  touch "$SQL_FILE"
  if $WRANGLER d1 export "$db_name" --remote --output="$SQL_FILE" -y 2>>"$LOG"; then
    SIZE=$(du -h "$SQL_FILE" | cut -f1)
    log "  ✓ ${db_name}: SQL export ${SIZE} → ${SQL_FILE}"
    cp "$SQL_FILE" "$BACKUP_ROOT/${db_name}-latest.sql"
  elif grep -q "cannot export databases with Virtual Tables (fts5)" "$LOG"; then
    # Strategy 2: FTS5 detected — use Time Travel bookmark instead
    # Bookmark enables full restore via `wrangler d1 time-travel restore`
    rm -f "$SQL_FILE"   # Remove the empty/partial SQL file
    BOOKMARK=$($WRANGLER d1 time-travel info "$db_name" --json 2>>"$LOG" | \
      python3 -c "import sys,json; print(json.load(sys.stdin).get('bookmark',''))" 2>/dev/null || echo "")

    if [ -n "$BOOKMARK" ] && [ "$BOOKMARK" != "null" ]; then
      log "  ✓ ${db_name}: FTS5 database — bookmark ${BOOKMARK:0:24}… → ${BOOKMARK_FILE}"
      echo "$BOOKMARK" > "$BOOKMARK_FILE"
      cp "$BOOKMARK_FILE" "$BACKUP_ROOT/${db_name}-latest.bookmark"
      # Also record the restore command
      echo "Restore: wrangler d1 time-travel restore ${db_name} --bookmark=${BOOKMARK}" >> "$LOG"
    else
      log "  ✗ ${db_name}: Time Travel bookmark retrieval failed"
      FAILURES=$((FAILURES + 1))
    fi
  else
    log "  ✗ ${db_name}: EXPORT FAILED (non-FTS5 error — see log)"
    FAILURES=$((FAILURES + 1))
  fi
done

log "=== Backup complete: $((3 - FAILURES)) succeeded, ${FAILURES} failed ==="

# ── Cleanup: keep last 30 days ─────────────────────────────────────────────
find "$BACKUP_ROOT" -name "*.sql" -not -name "*-latest.sql" -mtime +30 -delete 2>/dev/null
find "$BACKUP_ROOT" -name "*.bookmark" -not -name "*-latest.bookmark" -mtime +30 -delete 2>/dev/null

# ── Summary ────────────────────────────────────────────────────────────────
log "Backup files in ${BACKUP_ROOT}:"
ls -lh "$BACKUP_ROOT"/*.sql "$BACKUP_ROOT"/*.bookmark 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}' >> "$LOG" || true

exit "$FAILURES"
