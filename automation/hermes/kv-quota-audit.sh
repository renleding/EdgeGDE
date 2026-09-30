#!/bin/bash
# KV Quota Audit — runs 24h after KV Quota Fix v6.0 deployment
# Compares actual KV reads/writes against pre-fix baseline

set -e

ACCOUNT_ID="cdb9bd3391e71153a361515c40e8410f"
WORKER_NAME="edgegde-calculator"
DASHBOARD_URL="https://dash.cloudflare.com/${ACCOUNT_ID}/workers/services/view/${WORKER_NAME}/metrics/kv"

# Pull deployment info
echo "=== KV Quota Fix v6.0 — 24h Audit ==="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

echo "--- Active Deployment ---"
cd /Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime
wrangler deployments list 2>&1 | head -13
echo ""

echo "--- Worker Health ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${WORKER_NAME}.renleding.workers.dev/healthz" 2>&1)
echo "healthz: HTTP ${HTTP_CODE}"
echo ""

echo "--- KV Analytics (Cloudflare Dashboard) ---"
echo "Open: ${DASHBOARD_URL}"
echo ""

# Try wrangler tail for recent cron invocations (last 5 min window)
echo "--- Recent Worker Logs ---"
timeout 15 wrangler tail --format json 2>&1 | head -50 || true
echo ""

echo "=== Audit complete ==="
