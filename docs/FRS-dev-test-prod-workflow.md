# Functional Requirements Specification: EdgeGDE Deployment Workflow

## 1. Objective

Establish a structured dev/test/staging/production deployment pipeline for the EdgeGDE application running on Cloudflare Workers. The current state deploys directly to production on every `main` branch merge with no staging environment, no rollback capability, and no pre-production validation. This FRS defines requirements to introduce:

- A **staging worker** that mirrors production bindings (D1, KV, Queues, DOs) for integration testing
- An **environment-aware configuration system** supporting dev/staging/prod environments
- A **gated production deployment** with manual approval and rollback procedures
- **CI/CD integration** including end-to-end tests against staging before production promotion

---

## 2. Current Baseline

| Aspect | State | Details |
|--------|-------|---------|
| **Deploy command** | `cd apps/edge-runtime && npx wrangler deploy` | Single environment, no env config |
| **CI pipeline** | Runs on every PR | Typecheck (0 errors), Unit tests (439/439 passing), lint, governance checks |
| **Post-merge workflow** | Captures metrics only | No deployment action; direct prod deploy on `main` merge |
| **Local dev** | `wrangler.local.toml` with Miniflare stubs | Worktree branches supported |
| **Staging worker** | Does not exist | — |
| **Production worker name** | `edgegde-calculator.renleding.workers.dev` | Single environment in `wrangler.json` |
| **Secrets management** | `wrangler secret put` + `~/.env` file | No per-environment separation |
| **Database** | D1: `ebroker_leads` (single production DB) | — |
| **KV namespaces** | ARTIFACT_KV, TENANT_KV, TELEMETRY_KV | Global replication; no staging isolation |
| **Durable Objects** | RateLimiter, AuditLedger, ChatSession_DO, CanvasSession_DO | Tied to worker name |
| **Queues** | LEAD_SCORING_QUEUE, FORECASTING_QUEUE | Single queue per binding |

---

## 3. Proposed Architecture

### 3.1 Environment Configuration Strategy

Two viable approaches for environment configuration are evaluated in Section 4. The recommended approach uses a single `wrangler.jsonc` with an `env` object containing `dev`, `staging`, and `prod` configurations, each defining their own bindings and secrets references. This avoids file proliferation while maintaining clear separation.

### 3.2 Deployment Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   DEV        │    │   STAGING    │    │   PRODUCTION  │    │   ROLLBACK    │
│ (worktree)   │    │ (PR merge)   │    │ (main + gate) │    │ (manual)      │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                    │                  │                 │
  Local dev             GitHub Actions     Manual approval   wrangler rollback
  Miniflare stubs       Auto-deploy        + CI gates        or git revert
```

**Pipeline stages:**

1. **PR Opened** → Typecheck, lint, unit tests (existing)
2. **Staging Branch Merge** → Deploy to staging worker with full bindings
3. **E2E Tests Against Staging** → Run integration test suite against deployed staging worker
4. **Production Gate** → Manual approval required before prod deploy
5. **Production Deploy** → Deploy to `prod` environment in wrangler config
6. **Rollback** → Documented procedure using `wrangler rollback` or revert + redeploy

### 3.3 Bindings Matrix

| Binding Type | Production | Staging | Dev (Local) | Notes |
|--------------|-----------|---------|-------------|--------|
| **D1 Database** | `ebroker_leads` (prod DB) | New staging DB (`ebroker_staging`) | Miniflare stub | D1 requires separate databases per environment |
| **KV: ARTIFACT_KV** | Production namespace | Separate staging namespace | Miniflare stub | KV namespaces must be created separately |
| **KV: TENANT_KV** | Production namespace | Separate staging namespace | Miniflare stub | Same constraint as above |
| **KV: TELEMETRY_KV** | Production namespace | Separate staging namespace | Miniflare stub | Telemetry data isolation required |
| **DO: RateLimiter** | `RateLimiter` (prod worker) | `RateLimiter-staging` | Miniflare stub | DO names tied to worker identity |
| **DO: AuditLedger** | `AuditLedger` (prod worker) | `AuditLedger-staging` | Miniflare stub | Same constraint |
| **DO: ChatSession_DO** | `ChatSession_DO` (prod worker) | `ChatSession_DO-staging` | Miniflare stub | Session isolation required |
| **DO: CanvasSession_DO** | `CanvasSession_DO` (prod worker) | `CanvasSession_DO-staging` | Miniflare stub | Same constraint |
| **Queue: LEAD_SCORING_QUEUE** | Production queue | Separate staging queue | Miniflare stub | Queue names must differ per env |
| **Queue: FORECASTING_QUEUE** | Production queue | Separate staging queue | Miniflare stub | Same constraint |
| **Secrets** | Per-env secrets via Actions | Per-env secrets via Actions | `~/.env` file | Secrets provisioned separately per environment |

### 3.4 Secrets Management Strategy

- **Production secrets**: Provisioned via GitHub Actions secrets, injected at deploy time using `wrangler secret put --env=prod`
- **Staging secrets**: Same mechanism but with separate staging-specific values (e.g., different API keys, database connection strings)
- **Dev secrets**: Loaded from local `~/.env` file; no CI provisioning needed
- **Secret rotation**: Documented procedure for rotating production secrets without redeploying the entire worker

---

## 4. Option Comparison: Environment Configuration Structure

### Option A: Single `wrangler.jsonc` with `env` Object (Recommended)

**Structure:**
```jsonc
{
  "name": "edgegde-calculator",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "env": {
    "dev": {
      "d1_databases": { "ebroker_leads": { binding: "DB" } },
      "kv_namespaces": { "ARTIFACT_KV": { binding: "KV" } },
      // ... etc.
    },
    "staging": {
      "d1_databases": { "ebroker_staging": { binding: "DB" } },
      "kv_namespaces": { "ARTIFACT_STAGING": { binding: "KV" } },
      // ... etc.
    },
    "prod": {
      "d1_databases": { "ebroker_leads": { binding: "DB" } },
      "kv_namespaces": { "ARTIFACT_KV": { binding: "KV" } },
      // ... etc.
    }
  }
}
```

**Pros:**
- Single source of truth; no file proliferation
- Wrangler CLI natively supports `--env` flag for deployment targeting
- Easier to maintain and review in PRs (one config file)
- Consistent with Cloudflare Workers best practices

**Cons:**
- Larger initial config file; may become unwieldy if many bindings exist
- Requires careful naming conventions to avoid confusion between environments

### Option B: Separate Config Files (`wrangler.json`, `wrangler.staging.json`, `wrangler.prod.json`)

**Structure:**
```jsonc
// wrangler.json (dev only)
{ "name": "edgegde-calculator", "main": "src/index.ts", ... }

// wrangler.staging.json
{ "name": "edgegde-calculator-staging", "main": "src/index.ts", "env": { "staging": {...} }, ... }

// wrangler.prod.json
{ "name": "edgegde-calculator", "main": "src/index.ts", "env": { "prod": {...} }, ... }
```

**Pros:**
- Clear visual separation between environments
- Each file can be reviewed independently in PRs
- Easier to onboard new team members (less cognitive load per environment)

**Cons:**
- Three config files to maintain; risk of drift between them
- Staging worker name differs from production, which may cause confusion in monitoring/logging
- Requires custom deploy scripts or CI logic to select the correct config file
- More surface area for configuration errors

### Recommendation: Option A (Single `wrangler.jsonc` with `env`)

The single-config approach is recommended because it aligns with Cloudflare Workers' native environment support, reduces maintenance burden, and keeps all deployment configurations in one reviewed document. The staging worker name can be set to match production (`edgegde-calculator.renleding.workers.dev`) by using the same worker name across environments—this requires careful wrangler configuration but provides consistent identity for monitoring.

---

## 5. Acceptance Criteria

### AC-1: Staging Worker Deployment
- [ ] A staging environment is deployed automatically on PR merge to a designated `staging` branch (e.g., `release/staging`)
- [ ] Staging worker has its own D1 database, KV namespaces, queues, and DO bindings that mirror production structure
- [ ] Deploy command: `wrangler deploy --env=staging` succeeds without errors

### AC-2: Environment Configuration
- [ ] Single `wrangler.jsonc` file contains all three environments (`dev`, `staging`, `prod`)
- [ ] Each environment has distinct binding references (separate DB names, KV namespaces, queue names)
- [ ] Production environment uses the existing worker name and bindings

### AC-3: Gated Production Deployment
- [ ] Production deploy requires manual approval in GitHub Actions workflow
- [ ] Approval gate is enforced before `wrangler deploy --env=prod` executes
- [ ] Deploy command: `wrangler deploy --env=prod` succeeds after approval

### AC-4: Rollback Procedure
- [ ] Documented rollback procedure exists using either:
  - `wrangler rollback <version>` (Cloudflare-managed rollback)
  - Git revert + re-deploy to previous known-good version
- [ ] Rollback procedure is tested and documented in runbook
- [ ] Rollback restores the production worker to a previously deployed state

### AC-5: E2E Testing Against Staging
- [ ] End-to-end test suite runs against the staging worker after deployment
- [ ] Tests cover critical user flows (lead scoring, forecasting, session management)
- [ ] Test results gate production deployment approval

### AC-6: Secrets Management
- [ ] Production secrets are provisioned via GitHub Actions secrets
- [ ] Staging secrets are distinct from production and managed separately
- [ ] Dev environment uses local `~/.env` file without CI provisioning

### AC-7: CI/CD Integration
- [ ] Existing PR checks (typecheck, unit tests, lint) continue to run on every PR
- [ ] New staging deploy pipeline runs only on merges to the staging branch
- [ ] Production deploy pipeline includes E2E test results as a gate condition

### AC-8: Cost Efficiency
- [ ] No paid-tier Cloudflare Workers features are used unnecessarily
- [ ] Staging environment uses free-tier-compatible resources where possible
- [ ] D1 staging database is provisioned within budget constraints (D1 has limited free tier; may require cost review)

---

## 6. Implementation Phases

### Phase 1: Environment Configuration & Local Dev Validation (Weeks 1–2)

**Deliverables:**
- Create `wrangler.jsonc` with `env` object containing `dev`, `staging`, and `prod` configurations
- Define all binding references for each environment in the config file
- Update local dev workflow documentation to reference new staging configuration
- Validate that `wrangler deploy --help` shows env flag support

**Tasks:**
1. Draft initial `wrangler.jsonc` with all three environments
2. Create a local dev validation script that confirms wrangler recognizes all environments
3. Document the binding matrix for each environment in the project README
4. Review and update CI configuration to acknowledge new deploy commands

### Phase 2: Staging Pipeline & E2E Testing (Weeks 3–5)

**Deliverables:**
- GitHub Actions workflow that deploys staging on PR merge to `release/staging` branch
- Provisioning of staging D1 database, KV namespaces, queues, and DO bindings via Cloudflare CLI or API
- E2E test suite configured to run against the deployed staging worker
- Secrets provisioning script for staging environment

**Tasks:**
1. Create GitHub Actions workflow: `deploy-staging.yml` triggered on PR merge to `release/staging`
2. Implement secrets provisioning step using `wrangler secret put --env=staging` with CI-managed values
3. Provision staging D1 database (requires Cloudflare account admin access for new DB creation)
4. Create separate KV namespaces for staging via Cloudflare API or CLI
5. Build E2E test suite targeting the staging worker URL
6. Configure workflow to run E2E tests after successful staging deploy

### Phase 3: Production Gate & Rollback (Weeks 6–8)

**Deliverables:**
- GitHub Actions workflow with manual approval gate for production deployment
- `wrangler rollback` procedure documented and tested
- Secrets rotation runbook created
- Full CI/CD pipeline operational end-to-end

**Tasks:**
1. Create GitHub Actions workflow: `deploy-production.yml` with approval step
2. Implement `wrangler deploy --env=prod` after manual approval
3. Document rollback procedure (both `wrangler rollback` and git revert approaches)
4. Test rollback by deploying a known-bad version, then rolling back to previous version
5. Create secrets rotation runbook for production environment
6. Conduct full pipeline validation: PR → staging deploy → E2E tests → prod approval → deploy → verify

---

## 7. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **D1 single production DB constraint** | Staging cannot use the same D1 database as production; must create a separate staging DB which may incur cost or require account admin access | High | Apply for Cloudflare Workers paid plan if free tier D1 limits are reached; document budget review process |
| **KV global replication** | Separate KV namespaces required for staging; namespace creation is manual and not automated by wrangler CLI | Medium | Use Cloudflare API to provision staging namespaces programmatically in CI workflow |
| **DO name binding to worker identity** | Staging DOs must have different names (e.g., `RateLimiter-staging`); this may cause confusion if monitoring uses DO names | Low | Establish naming convention: `<binding>-staging` for all staging DOs; document in runbook |
| **E2E test flakiness** | Tests against live staging worker may fail due to network issues, rate limits, or transient errors | Medium | Implement retry logic with exponential backoff in CI workflow; set reasonable timeout thresholds |
| **Manual approval fatigue** | Production deploy requires manual approval which may slow down release cycles for small teams | Low | Consider auto-approval after successful staging E2E tests if team size and risk tolerance allow (document decision criteria) |
| **Cost overruns on D1 staging** | Separate D1 database for staging incurs additional storage/compute costs | Medium | Monitor D1 usage metrics; set alert thresholds; review cost quarterly |
| **Configuration drift between environments** | If separate config files are used, prod and staging configs may diverge unintentionally | Low (if using single `wrangler.jsonc`) | Use single-config approach to eliminate this risk entirely |
| **Secrets provisioning failure in CI** | Secrets not properly injected during deploy could cause runtime failures | Medium | Implement secrets validation step before deploy; fail fast if required secrets are missing |

---

## Appendix A: Deployment Command Reference

```bash
# Local dev (existing)
cd apps/edge-runtime && npx wrangler local

# Staging deploy (new)
cd apps/edge-runtime && npx wrangler deploy --env=staging

# Production deploy (new, after approval)
cd apps/edge-runtime && npx wrangler deploy --env=prod

# Rollback production (documented procedure)
cd apps/edge-runtime && npx wrangler rollback <version>
```

## Appendix B: GitHub Actions Workflow Triggers

| Workflow | Trigger | Branch | Action |
|----------|---------|--------|--------|
| `ci.yml` | PR opened/synced | Any branch | Typecheck, lint, unit tests |
| `deploy-staging.yml` | PR merged | `release/staging` | Deploy to staging + E2E tests |
| `deploy-production.yml` | Tag push or manual trigger | — | Approval gate → deploy prod |

## Appendix C: Rollback Decision Matrix

```
┌─────────────────────┬──────────────────┬──────────────────────────┐
│ Scenario             │ Action           │ Procedure                │
├─────────────────────┼──────────────────┼──────────────────────────┤
│ Minor bug in prod   │ wrangler rollback│ Use wrangler rollback    │
│                    │ <version>        │ to previous version      │
├─────────────────────┼──────────────────┼──────────────────────────┤
│ Major outage         │ Git revert       │ Revert code + redeploy   │
│                      │                  │ to known-good commit     │
├─────────────────────┼──────────────────┼──────────────────────────┤
│ Config error         │ Manual fix       │ Fix wrangler.jsonc,      │
│                      │                  │ redeploy with --env=prod │
└─────────────────────┴──────────────────┴──────────────────────────┘
```

---

*Document Version: 1.0 | Last Updated: 2024-07-15 | Author: Cloudflare Workers Infrastructure Team*