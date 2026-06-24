# EdgeGDE — Next Phase Plan (Phase 2)

**Date:** 2026-06-24  
**Previous phase:** Observability + Production Hardening (complete)

---

## Completed in Phase 1

| Capability | Status |
|-----------|--------|
| OTel observability stack (SigNoz + collector) | ✅ Deployed |
| Domain trace attributes (correlationId, tenantId, etc.) | ✅ Shipped |
| Compensating action lifecycle | ✅ Shipped |
| Replay-based testing | ✅ Shipped |
| Reconciliation loop | ✅ Shipped |
| Dry-run mission mode | ✅ Shipped |
| gogo as manifest field | ✅ Shipped |
| Correlation enforcement middleware | ✅ Shipped |
| CI pipeline (typecheck + unit tests) | ✅ Shipped |
| Action registry with compensate() stubs | ✅ Shipped |
| Worker deployed to staging | ✅ Deployed |

---

## Phase 2: Integration & Verification

The lifecycle code is written and deployed, but NOT yet wired into the actual request path. The existing `index.ts` route handlers still dispatch actions directly — they don't call `runMission()`.

### Priority 1: Wire lifecycle runner into existing routes (3d)

**What:** Replace direct action dispatch in route handlers with `runMission()` calls.

**How:** 
- `src/routes/api.ts` currently calls `tool.execute()`. Replace with:
  ```typescript
  const result = await runMission({
    mission: missionDef,
    manifest: buildManifestFromRequest(c),
    correlationId: getCorrelationId(c),
    tenantId: c.var.tenant.tenantId,
    env: c.env,
  })
  ```
- Register actions at startup: `registerSystemActions()`
- Add `registerSystemActions()` call in `index.ts` app initialization

**Verify:** Send a request to the API, confirm it flows through the lifecycle runner and produces OTel spans with `app.correlation.id`.

### Priority 2: OTel span verification from deployed worker (1d)

**What:** Confirm the worker produces correct OTel spans with domain attributes.

**How:**
1. Hit the staging worker: `curl https://edgegde-calculator-staging.renleding.workers.dev/api/v1/leads`
2. Check SigNoz for spans with `app.correlation.id`, `app.tenant.id`
3. Verify the tunnel is passing data through
4. Fix any attribute gaps

### Priority 3: Fill in actual compensate() implementations (2d)

**What:** Replace the stub `compensate()` functions in `registry.ts` with real reverse operations.

**Actions needing real compensation:**
- `lead.capture` → delete/archive the lead in D1
- `site.publish` → call `site.rollback` API
- `canvas.add_node` → call `canvas.delete_node`
- `calculator.insert` → delete the inserted record

### Priority 4: Run replay tests in CI on every PR (0.5d)

**What:** The CI workflow is created but hasn't run yet. Record a real mission execution and commit it as a fixture, then verify the replay test catches a regression.

### Priority 5: Finish SigNoz dashboard panels 4-5 (0.5d)

**What:** Add "Top Drifted Actions" (Table) and "Mission Health Summary" (Time Series) panels to the EdgeGDE Mission Drift dashboard.

**Queries in:** `docs/DRIFT-DASHBOARDS.md`

---

## Future (Phase 3)

| Item | Depends on | Effort |
|------|-----------|--------|
| Mission cost attribution (LLM tokens per mission) | OTel spans flowing | 2d |
| Multi-tenant onboarding (self-service) | Production readiness | 5d |
| Replay from AuditLedger (not just fixtures) | FRS-2 deployed | 2d |
| Dead letter queue UI for failed compensations | Compensations flowing | 2d |
| Circuit breaker for LLM providers | External dependency tracing | 1d |
