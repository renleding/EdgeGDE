#!/usr/bin/env bash
# provision-staging.sh — Create staging Cloudflare resources
# Run once before first staging deployment.
# Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in env
set -euo pipefail

echo "=== Provisioning EdgeGDE Staging Resources ==="
echo ""

# ── D1 Database ────────────────────────────────────────────────
echo "1. Creating staging D1 database..."
D1_RESULT=$(npx wrangler d1 create ebroker_leads_staging 2>&1)
D1_ID=$(echo "$D1_RESULT" | grep -oP 'database_id=\K[a-f0-9-]+' || echo "")
if [ -n "$D1_ID" ]; then
  echo "   D1 staging DB ID: $D1_ID"
  echo "   → Set this in wrangler.jsonc env.staging.d1_databases[0].database_id"
  # Apply migrations
  npx wrangler d1 migrations apply ebroker_leads_staging --env staging 2>&1 || true
else
  echo "   D1 staging DB may already exist. Find ID via: npx wrangler d1 list"
fi

# ── KV Namespaces ──────────────────────────────────────────────
echo ""
echo "2. Creating staging KV namespaces..."
for KV_BINDING in ARTIFACT_KV TENANT_KV TELEMETRY_KV; do
  KV_NAME="edgegde-${KV_BINDING,,}-staging"
  KV_RESULT=$(npx wrangler kv:namespace create "$KV_NAME" 2>&1)
  KV_ID=$(echo "$KV_RESULT" | grep -oP 'id=\K[a-f0-9-]+' || echo "")
  if [ -n "$KV_ID" ]; then
    echo "   $KV_BINDING staging ID: $KV_ID"
    echo "   → Set this in wrangler.jsonc env.staging.kv_namespaces"
  else
    echo "   $KV_BINDING may already exist. Find ID via: npx wrangler kv:namespace list"
  fi
done

# ── R2 Bucket ──────────────────────────────────────────────────
echo ""
echo "3. Creating staging R2 bucket..."
npx wrangler r2 bucket create edgegde-vault-staging 2>&1 || echo "   Bucket may already exist: edgegde-vault-staging"

# ── Queues ─────────────────────────────────────────────────────
echo ""
echo "4. Creating staging queues..."
for QUEUE in edgegde-lead-scoring-staging edgegde-forecasting-staging; do
  npx wrangler queues create "$QUEUE" 2>&1 || echo "   Queue may already exist: $QUEUE"
done

echo ""
echo "=== Provisioning complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy the D1 and KV IDs into wrangler.jsonc env.staging sections"
echo "  2. Run: npx wrangler deploy --env staging"
echo "  3. Verify: https://edgegde-calculator-staging.renleding.workers.dev"
