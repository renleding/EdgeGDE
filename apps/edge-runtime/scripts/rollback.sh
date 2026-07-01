#!/usr/bin/env bash
# rollback.sh — EdgeGDE Deployment Rollback
# Usage:
#   bash scripts/rollback.sh staging     # Roll back staging to previous version
#   bash scripts/rollback.sh production  # Roll back production to previous version
#   bash scripts/rollback.sh staging --wrangler  # Use wrangler rollback (no git revert)
set -euo pipefail

ENV="${1:-}"
MODE="${2:-git}"  # git or wrangler

if [ -z "$ENV" ]; then
  echo "Usage: $0 <staging|production> [--wrangler]"
  exit 1
fi

case "$ENV" in
  staging)    WORKER="edgegde-calculator-staging" ;;
  production) WORKER="edgegde-calculator" ;;
  *) echo "Unknown environment: $ENV"; exit 1 ;;
esac

echo "=== Rollback: $ENV ($WORKER) ==="

if [ "$MODE" = "wrangler" ]; then
  # Option A: Wrangler rollback to previous version
  echo "Method: wrangler rollback"
  echo "Finding previous version..."
  npx wrangler rollback "$WORKER" 2>&1 || echo "wrangler rollback failed"
else
  # Option B: Git revert + redeploy
  echo "Method: git revert"
  echo "Current commit: $(git rev-parse --short HEAD)"
  echo "Reverting last commit..."
  git revert --no-edit HEAD

  echo "Pushing revert..."
  git push origin main

  echo "Redeploying $ENV..."
  if [ "$ENV" = "production" ]; then
    npx wrangler deploy --env production
  else
    npx wrangler deploy --env staging
  fi

  echo "Rollback complete. New commit: $(git rev-parse --short HEAD)"
fi

echo "=== Verifying rollback ==="
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$WORKER.renleding.workers.dev/" 2>/dev/null || echo "failed")
echo "Health check: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "401" ]; then
  echo "✅ $ENV is responding"
else
  echo "⚠️  $ENV health check returned $HTTP_CODE — manual investigation needed"
fi
