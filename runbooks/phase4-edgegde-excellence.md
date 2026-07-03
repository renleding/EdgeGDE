# EdgeGDE Excellence — Phase 4 Roadmap

**Status:** Partially complete  
**Previous session accomplishments:**
- ✅ Replay test wired into CI (code-quality job)
- ✅ Compensate strategy documented per route
- ✅ Canvas PWA modular architecture deployed
- ✅ Staging environment runbook
- ✅ Chat health check fixed
- ✅ 7 stale branches cleaned

---

## Remaining Phase 4 Items

### P1 — Multi-Tenant Self-Service Onboarding
**Reference:** `docs/FRS-multi-tenant-self-service-onboarding.md`  
**Work:** Create a self-service tenant registration endpoint with Turnstile verification, KV tenant provisioning, and D1 tenant schema init. Currently tenants are hardcoded in wrangler config.

### P1 — End-to-End Test Suite in CI
**Work:** Wire the existing E2E test suite (`bun run test:e2e`) into CI as a blocking gate on the deploy-production workflow. Currently it only runs on manual promote.

### P2 — Performance Audit
**Work:** Run Lighthouse on both the AI Tutor PWA and Canvas PWA. Audit bundle sizes, JS execution time, first-contentful-paint. The monolithic pwa.js was 971 lines — now modular at 1,235 lines split across 10 files.

### P2 — Documentation Completeness
**Remaining docs to write:**
- API reference for all tutor endpoints (`/api/tutor/math/*`)
- Canvas PWA developer guide (how to add new object types)
- Backup/disaster recovery runbook (Cubbit restore procedure)

### P3 — Security Hardening Follow-up
**Reference:** PR #34 (already merged)  
**Remaining:** Verify P2 items (SameSite=Strict, rate-limiter fail-closed) are working in production. Run a quarterly `npm audit` / `bun audit` check.

### P3 — OTEL Observability
**Work:** Validate OTel spans are flowing from the production worker to the configured endpoint. Add tracing spans for AI Tutor API calls. Currently OTEL vars are set but no custom spans.

---

## How to Action

Each item above is sized for a single PR. Suggested execution order:
1. Multi-tenant onboarding (highest business value)
2. E2E test suite in CI (highest safety value)
3. Performance audit (quick wins)
4. Documentation (fills knowledge gaps)
5. Security follow-up (verification only)
6. OTEL spans (nice-to-have)
