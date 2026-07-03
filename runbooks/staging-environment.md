# Staging Environment — EdgeGDE

**Worker:** `edgegde-calculator-staging`  
**URL:** https://edgegde-calculator-staging.renleding.workers.dev  
**Config:** `apps/edge-runtime/wrangler.jsonc` → `env.staging`  
**Deploy:** Merge to `staging` branch OR `workflow_dispatch` on `deploy-staging.yml`

---

## What's Different from Production

| Resource | Production | Staging |
|----------|-----------|---------|
| Worker name | `edgegde-calculator` | `edgegde-calculator-staging` |
| D1 database | `ebroker_leads` | `ebroker_leads_staging` |
| KV (TENANT_KV) | `04893a14…` | `f6746219…` |
| KV (ARTIFACT_KV) | `95a35fb5…` | `1361480a…` |
| KV (TELEMETRY_KV) | `588cdc55…` | `44431bd1…` |
| R2 Bucket | `edgegde-vault` | `edgegde-vault-staging` |
| CRON triggers | `0 8,20 * * *` | (disabled) |
| OTEL service name | `edgegde-worker` | `edgegde-worker-staging` |

## Deploying to Staging

### Automatic (push to staging branch)

```bash
git checkout -b staging main
git push origin staging
```

The `deploy-staging.yml` workflow auto-deploys on push to `staging`.

### Manual (workflow dispatch)

1. Go to GitHub → Actions → "Deploy — Staging"
2. Click "Run workflow"
3. Select the branch/commit to deploy

## Promoting Staging → Production

Run the "Promote — Staging → Production" workflow (manual dispatch only):

1. Go to GitHub → Actions → "Promote — Staging → Production"
2. Click "Run workflow"
3. Optionally specify a commit SHA (defaults to latest `main`)
4. The workflow:
   - Verifies staging is healthy
   - Runs e2e tests against staging
   - Deploys to production
   - Verifies production health
   - Records the promotion to `.promote-log/`

## Local Testing Against Staging

```bash
# Point local tools at staging
export EDGE_RUNTIME_BASE_URL=https://edgegde-calculator-staging.renleding.workers.dev

# Run e2e tests against staging
EDGE_RUNTIME_BASE_URL=$EDGE_RUNTIME_BASE_URL bun run test:e2e
```

## Seeding Test Data

Staging has its own KV namespace — tenant data is not shared with production.
To seed a test tenant in staging:

```bash
# Via wrangler
npx wrangler kv:key put --namespace-id f6746219... \
  "tenant:alpha-broker-01" \
  "$(cat fixtures/alpha-broker-01.json)" \
  --env staging
```
