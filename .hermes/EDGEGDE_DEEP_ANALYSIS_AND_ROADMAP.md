# EdgeGDE — Deep Analysis, Issues, Improvement Plan & Next-Gen Roadmap

> Generated: 2026-05-26 | Based on full codebase analysis (35 source files, 12 phase YAMLs, 4 config files)

---

## Part 1: Current Architecture

```
UIBuilder (Tauri/Vue 3 Desktop)
  └─→ POST /api/v1/agent/publish ──→ KV (ARTIFACT_KV)
                                          │
End User ──→ GET /?tenant=X&env=Y ──→ compileLayout() ──→ Inline-Style HTML
                                          │
End User ──→ POST /api/form/{id} ───→ Zod validate → HTMX response → D1 (waitUntil)
                                          │
MCP Agent ──→ GET /.well-known/mcp.json ──→ POST /api/v1/:toolId
                                          │
Admin ──→ GET /api/admin/leads/:tenantId ──→ D1 query (Bearer auth)
```

**Components:** Hono Workers app, UIBuilder (Vue 3 + Tauri + OpenPencil Canvas), shared op-schema package
**Storage:** KV (ARTIFACT_KV, TENANT_KV, TELEMETRY_KV), D1 (form_submissions), DO (RateLimiter)
**Key pattern:** Counter-based telemetry avoids `kv.list()`, fire-and-forget D1 via `waitUntil()`, Zod-first validation

---

## Part 2: Identified Issues (Prioritized)

### 🔴 CRITICAL — Fix Before Production

| # | Issue | Where | Risk | Why It Matters |
|---|-------|-------|------|----------------|
| C1 | **Hardcoded dev token in 3 route files** | `agent.ts:27`, `mcp-deploy.ts:33`, `dashboard.ts:218` | If `ADMIN_API_TOKEN` env var isn't set in prod Workers, all admin/MCP endpoints are wide open. The fallback `'edgegde-dev-token-2026'` is guessable. | **Unauthorized access to publish/promote/rollback/diff endpoints. Anyone who targets the Worker URL can deploy layouts. Zero security. Every route file has a copy-paste of the same fallback pattern.** |
| C2 | **Zod 3.x vs 4.x version mismatch** | `op-schema` uses `zod ^3.23.0`, `edge-runtime` uses `zod ^4.4.3` | Runtime imports `@edgegde/schema` which uses Zod 3.x. Node modules end up with two Zod versions. Zod 4 broke many Zod 3 APIs (e.g., `z.string()` → new class). | **Silent validation failures or runtime errors when schemas mix versions.** Deploy locks, artifact validation, and form handlers could all silently fail. |
| C3 | **Duplicate schema definitions** | `UIBuilder/src/schemas/openpencil.ts` (260 lines) is a fork of `packages/op-schema/src/openpencil.ts` | Two copies of the same Zod schemas. Edits to one don't sync. | **Any schema change requires manual sync. Already 3 lines of drift observed.** UIBuilder could validate against a stale schema version, publishing bad data. |

### 🟠 HIGH — Should Fix Before Adding Features

| # | Issue | Where | Risk | Why It Matters |
|---|-------|-------|------|----------------|
| H1 | **Deploy locks have no TTL** | `registry.ts:acquireDeployLock()` writes KV key with `'1'` but never sets `expirationTtl` | If a deploy crashes mid-operation, the lock key persists forever. Subsequent deploys are permanently blocked until manual KV delete. | **Cron-level availability issue.** Any crash during deployment permanently blocks all future deploys for that tenant. |
| H2 | **In-memory registries never hydrate from KV at startup** | `calculators.ts`, `pages.ts`, `themes.ts` have `hydrate*FromKV()` functions but `index.ts` never calls them | After a Worker restart, `CALCULATOR_REGISTRY`, `PAGE_REGISTRY`, `THEME_REGISTRY` are empty. Only a new publish request fills them. | **All calculator/page/theme lookups fail until first publish request arrives.** Site rendering for previously published content breaks on every Worker cold start. |
| H3 | **Weak 32-bit custom hash for idempotency** | `publish.ts:76`, `agent.ts:192` use `hash << 5 - hash + charCode` | Collision probability at 10K artifacts is ~1%. At 100K, ~50%. No SHA-256 used despite proper SHA-256 existing in `versioning.ts`. | **Duplicate artifacts could silently overwrite each other.** Content-based addressing loses integrity. The hash function has visible collision risk at scale. |
| H4 | **Form endpoints not rate limited** | `form-registry.ts` mounts `/api/form/{id}` routes outside the rate limiter coverage | Rate limiter middleware only covers `/api/v1/*`. Anyone can hammer form endpoints unlimited. | **Trivially DOS-able.** A single tenant can be flooded with form submissions, exhausting D1 write quota or hitting free-tier D1 limits. |
| H5 | **No test coverage for runtime** | `packages/op-schema/tests/` has 331 lines of schema tests. Zero tests for runtime. | Zero unit tests for calculator math, form handlers, compilers, API routes. Zero integration tests for KV/D1. | **Every change is a blind deployment.** No regression safety net. The calculator math (amortization, currency) has no tests despite being the core business logic. |

### 🟡 MEDIUM — Significant Quality-of-Life

| # | Issue | Where | Risk | Why It Matters |
|---|-------|-------|------|----------------|
| M1 | **D1 persistence errors go to `console.error`** | `form-registry.ts:147` | In Workers, `console.error` goes nowhere in production. Failed D1 writes are invisible. | **Silent data loss.** Form submissions fail silently — no retry, no alert, no monitoring. |
| M2 | **`tenantConfig.tenantId` vs `tenantConfig.hostname` mismatch** | `form-registry.ts:127` reads `tenantId` but `tenant.ts` sets `hostname` | Falls back to `'default'` always. | **All form submissions tagged with tenant 'default' instead of actual tenant.** Admin API filtering by tenant is broken. |
| M3 | **Multiple global MemoryKvStore singletons** | `publish.ts`, `agent.ts`, `mcp-deploy.ts` each have their own | In dev, in-memory data is fragmented across instances. | **Dev-only, but prevents proper local testing.** Publish via agent.ts won't be visible in mcp-deploy.ts locally. |
| M4 | **No CORS configuration** | No CORS headers anywhere | UIBuilder runs on a different origin (Tauri webview or local dev port). | **Browser-based API calls from UIBuilder will fail.** Only works because UIBuilder likely uses a Tauri HTTP client, not browser fetch. |
| M5 | **`Any` types used pervasively** | Especially `(c.env as any)` across all route files (~15+ occurrences) | TypeScript can't catch KV/D1 binding name mismatches. | **A renamed KV binding becomes a hard-to-debug runtime error instead of a compile error.** |
| M6 | **KV key schema is string-literal spread** | Key patterns like `calc:${id}:latest` are hardcoded in 5+ files | No centralized KV key constants module. Keys must be grepped across the codebase. | **Key collision or drift between files.** Renaming a key pattern requires finding all usages by hand. |

### 🔵 LOW — Polish / Nice-to-Have

| # | Issue | Where | Risk |
|---|-------|-------|------|
| L1 | Legacy calculator copy in UIBuilder | `UIBuilder/src/routes/staged/calculator.ts` — duplicate of runtime calculator | Maintainability drag |
| L2 | Legacy 418-line compiler in UIBuilder | `UIBuilder/src/compiler/engine.ts` — superseded by runtime compiler | Confusion, dead code |
| L3 | No .gitignore for UIBuilder node_modules | Only top-level node_modules ignored | Accidental commits |
| L4 | D1 `ebroker_leads` table name confusion | Phase YAML references `ebroker_leads`, but `schema.sql` creates `form_submissions` | Unclear which table is authoritative |
| L5 | `Grid:*` composer renderer from spec not implemented | Phase 32 spec mentions Grid:* but registry.ts doesn't have it | Missing feature gap |
| L6 | No pagination cursor on Admin API | Uses offset pagination (no cursor token) | Page flip anomalies on concurrent inserts |

---

## Part 3: Improvement Plan (Phased, Do Not Execute)

### Phase A — Security & Reliability Foundation
**Why first:** Protects production data and prevents silent failures. Prerequisite for everything else.

| Step | What | Reason | Files |
|------|------|--------|-------|
| A1 | Move ADMIN_API_TOKEN fallback to a single source of truth with env var check + error | Eliminates the copy-paste security hole across 3 route files | new `lib/auth.ts`, then `agent.ts`, `mcp-deploy.ts`, `dashboard.ts` |
| A2 | Add `expirationTtl: 30` to deploy lock KV writes | Prevents permanent lock on crash | `lib/registry.ts` |
| A3 | Add startup hydration call in `index.ts` | Fixes cold-start failures for all registries | `index.ts` (add calls to hydrate*FromKV) |
| A4 | Add rate limiter coverage for `/api/form/*` and `/api/render` | Prevents form DOS and render abuse | `middleware/tenant.ts` or `index.ts` |
| A5 | Replace 32-bit custom hash with SHA-256 for idempotency | Eliminates collision risk | `publish.ts`, `agent.ts` |

### Phase B — Code Quality & Testability
**Why second:** Fixes the duplication and test gaps before adding new features.

| Step | What | Reason | Files |
|------|------|--------|-------|
| B1 | Align `op-schema` to Zod 4.x | Removes dual-Zod dependency clash | `packages/op-schema/package.json` |
| B2 | Make UIBuilder depend on `@edgegde/schema` instead of its own copy | Eliminates schema drift risk | `UIBuilder/src/schemas/openpencil.ts` (remove), update imports |
| B3 | Add unit tests for calculator math engine | Core business logic with zero coverage | new `tests/calculator.test.ts` |
| B4 | Add form handler unit tests | Form validation/processing has zero coverage | new `tests/form-registry.test.ts` |
| B5 | Add Admin API integration test (token auth + D1 query) | Security boundary test | new `tests/admin.test.ts` |
| B6 | Remove legacy calculator copy from UIBuilder | Dead code cleanup | `UIBuilder/src/routes/staged/calculator.ts` |
| B7 | Remove legacy compiler from UIBuilder | Dead code cleanup | `UIBuilder/src/compiler/engine.ts` |

### Phase C — Observability & Operational Excellence
**Why third:** Makes the system observable and debuggable in production.

| Step | What | Reason | Files |
|------|------|--------|-------|
| C1 | Route D1 persistence failures to TELEMETRY_KV counter | Replaces silent console.error with monitorable metric | `lib/form-registry.ts` |
| C2 | Add structured audit log to KV (who published/deployed/rolled back what) | Tracks all admin actions | `lib/audit.ts`, called from publish/promote/rollback |
| C3 | Add D1 write retry (1 retry, 1s delay via waitUntil) | Catches transient D1 failures | `lib/form-registry.ts` |
| C4 | Fix `tenantConfig.tenantId` vs `hostname` mismatch | Makes tenant filtering work correctly | `lib/form-registry.ts:127`, `middleware/tenant.ts` |
| C5 | Add Admin API cursor-based pagination | Solves page flip anomalies | `routes/dashboard.ts` or `index.ts` |

### Phase D — Architecture Hardening
**Why fourth:** Structural improvements that make the system scalable.

| Step | What | Reason | Files |
|------|------|--------|-------|
| D1 | Centralize KV key constants into `lib/kv-keys.ts` | Single source of truth for all key patterns | new file, update all 5+ callers |
| D2 | Unify MemoryKvStore into a single exported singleton from `publish.ts` | Fixes dev data fragmentation | `publish.ts`, `agent.ts`, `mcp-deploy.ts` |
| D3 | Add Zod schema validation for POST /api/render body | Accepts arbitrary JSON currently — potential XSS/spam | `index.ts` (add GET /api/render schema) |
| D4 | Add CORS middleware | Enables direct browser-based API access | `index.ts` or new `middleware/cors.ts` |
| D5 | Replace `(c.env as any)` with typed Hono environment | Catches binding name mismatches at compile time | All route files + `index.ts` |

### Phase E — Execute Planned Phases 32 & 33
**Why fifth:** These add new capabilities on top of a hardened foundation.

| Step | What | Reason |
|------|------|--------|
| E1 | Phase 32: Unified Registry Engine (typed renderers in registry.ts) | Replaces imperative HTML with extensible registry |
| E2 | Phase 33: Design Token Compiler (DESIGN.md → DesignTokens) | Enables brand-aware rendering |

---

## Part 4: Next-Gen Roadmap — 100/100 Strategy

> **Vision:** EdgeGDE becomes the world's simplest "idea-to-live" system — a mortgage broker designs a calculator in a visual editor, publishes it to a global edge network, collects leads, and manages them all from a unified dashboard. Zero DevOps. Zero servers. Zero configuration.

---

### Track 1: Security & Reliability (Score: 10/10 → 25/25)
*Phase A + B improvements*

| Milestone | Score | What It Enables |
|-----------|-------|-----------------|
| Token management centralized, env-only | +4 | No guessable fallback tokens anywhere |
| Deploy locks auto-release after 30s | +3 | Zero manual intervention on crashed deploys |
| Registries hydrate on cold start | +3 | No rendering failures on Worker restart |
| Rate limiting covers all endpoints | +3 | Hardened against abuse |
| SHA-256 content addressing | +2 | Deterministic idempotency, no collisions |
| Zod version aligned across packages | +2 | No silent validation failures |
| Schema in single source (no fork) | +2 | No drift between UIBuilder and runtime |
| Tests for core math, forms, admin | +3 | Regression safety net, confidence to ship |
| D1 failure monitoring (counters) | +2 | No silent data loss |
| Deploy lock TTL + audit logging | +1 | Operational visibility |
| **Track 1 Total** | **25/25** | **Production-ready foundation** |

---

### Track 2: Multi-Tenant Edge Platform (Score: 0/25 → 25/25)
*What EdgeGDE becomes with tenant isolation*

| Milestone | Score | What It Enables |
|-----------|-------|-----------------|
| **Tenant provisioning API** — `POST /api/admin/tenants` creates KV namespace + D1 shard. Each tenant gets isolated storage. | +5 | Onboard brokers without touching wrangler config. Self-service infrastructure. |
| **Per-tenant rate limits** — Each tenant has configurable RPM quota (stored in TENANT_KV). DO RateLimiter checks per-tenant token bucket. | +4 | One tenant can't DOS another. Fair resource allocation. |
| **Tenant-scoped DESIGN.md** — Each tenant uploads their brand DESIGN.md. Stored in KV per-tenant. Applied during compilation. | +4 | Unique brand per broker. One codebase, infinite visual variants. |
| **Custom domain per tenant** — `POST /api/admin/tenants/:id/domain` triggers Cloudflare custom hostname API. Auto-SSL via Cloudflare. | +4 | Brokers use their own domain (e.g., calc.janedoe.com). No subdomain hassle. |
| **Tenant admin dashboard** — Per-tenant view of leads, form submissions, deploy history. Separate from EdgeGDE system dashboard. | +4 | Brokers see only their data. Clean separation of concerns. |
| **Tenant activity log** — KV-backed append-only log per tenant (rollup monthly). | +2 | Audit trail per broker. |
| **Tenant deletion API** — `DELETE /api/admin/tenants/:id` purges all KV + D1 data. | +2 | GDPR compliance, clean churn. |
| **Track 2 Total** | **25/25** | **Multi-tenant edge platform** |

---

### Track 3: AI-Native Design-to-Live Pipeline (Score: 0/25 → 25/25)
*The "idea-to-live" core — how an AI agent creates, compiles, and publishes*

| Milestone | Score | What It Enables |
|-----------|-------|-----------------|
| **Natural language → LayoutDefinition** — Hermes/Claude describes a calculator in plain English. An MCP tool `edgegde_generate_layout` returns a complete `LayoutDefinition` JSON with calculator fields, form fields, branding. No visual editor needed. | +5 | "Create a borrowing power calculator with 3 sliders and a submit button" → instant deploy. 10 seconds from idea to live URL. |
| **Design token as prompt** — The MCP layout generator accepts a `designPrompt: "modern, blue, professional"` and auto-generates DesignTokens → injects into DESIGN.md → compiled into the rendered output. | +4 | No design skills needed. Describe the look and it's generated. |
| **A/B staging promotion** — The existing staging/production model (env:staging + promote) is exposed as MCP tools. Claude can say "promote staging to production for tenant X" and it happens. | +4 | AI can manage the full deployment lifecycle. |
| **Self-healing compilation** — If a compiled layout has rendering errors (detected via HTML validation), the system auto-generates a fixed version and re-promotes to staging. | +4 | No broken pages. Even if the generator emits bad output, the system catches and fixes it. |
| **AI-form migration** — Existing brokers with paper/PDF forms can upload them. EdgeGDE parses the form structure and generates the LayoutDefinition automatically. | +4 | Import legacy workflows without manual recreation. Zero migration cost. |
| **Incremental regeneration** — When a DESIGN.md changes, only recompile layouts that reference the changed tokens (not all layouts). | +2 | Fast iteration on design changes. |
| **Auto-test generation** — For each published layout, an MCP tool generates a test suite: "verify mortgage calculator inputs, verify HTMX form submission, verify D1 persistence". | +2 | Every layout gets automated QA. |
| **Track 3 Total** | **25/25** | **AI-native design pipeline** |

---

### Track 4: Universal Form & Lead Platform (Score: 0/25 → 25/25)
*Beyond mortgages — any form, any lead, any integration*

| Milestone | Score | What It Enables |
|-----------|-------|-----------------|
| **Dynamic form builder** — Brokers can add/reorder/remove form fields without code. UI in dashboard: drag fields, configure validation, set required/optional. | +5 | Zero-code form customization. No developer needed for field changes. |
| **Form templates** — Pre-built templates: "Mortgage Enquiry", "Refinance Quote", "Contact Broker", "Free Property Report". Brokers clone and customize. | +4 | 30-second form setup. Templates accelerate onboarding 10x. |
| **Webhook integration** — Form submissions fire webhooks to CRM (Salesforce, HubSpot, Pipedrive). Configured per-form, per-tenant. | +4 | No manual lead entry. Brokers' existing tools get auto-fed. |
| **Email notification** — On form submission, email broker. Configurable template. Uses Cloudflare Email Routing or SendGrid. | +3 | Brokers get instant notification without refreshing dashboard. |
| **Lead scoring** — Score leads based on loan amount, property type, employment status. Configurable scoring rules stored in KV. | +3 | Brokers prioritize high-value leads. Sales efficiency multiplier. |
| **Downloadable reports (CSV/PDF)** — Admin/Lead page has export buttons. D1 → CSV, D1 → PDF via puppeteer or a PDF generation service. | +3 | Easy data export for brokers to import into their CRM. |
| **Scheduled reports** — Weekly email digest: "You received 12 enquiries this week. Total loan value: $4.2M." Cron-based via Cloudflare Workers Cron Triggers. | +3 | Brokers get automated business intelligence without dashboard login. |
| **Track 4 Total** | **25/25** | **Universal lead platform** |

---

### Final Score: 100/100

```
Track 1: Security & Reliability         █████████████████████████ 25/25
Track 2: Multi-Tenant Edge Platform     █████████████████████████ 25/25
Track 3: AI-Native Design Pipeline      █████████████████████████ 25/25
Track 4: Universal Form & Lead Platform █████████████████████████ 25/25
                                        ─────────────────────────
                                        100/100 — World-class
```

---

## Part 5: Strategic Recommendations

### Do This Month (Weeks 1-4)
Focus on **Track 1** (25 points). Fix critical security holes and establish testing. Every hour spent now saves 10 hours of debugging later. Specifically:
1. Fix the hardcoded admin token (1 day)
2. Add deploy lock TTL + startup hydration (1 day)
3. Write calculator/form tests (2 days)
4. Align Zod versions + deduplicate schemas (1 day)
5. Add rate limiter for form endpoints (0.5 day)

### Do This Quarter (Months 2-3)
**Track 2** (25 points). Multi-tenant is the unlock — it turns a single-customer app into a platform. Without it, every new broker requires manual wrangler config changes and KV namespace creation.
1. Tenant provisioning API (1 week)
2. Per-tenant rate limits (2 days)
3. Custom domain support (3 days)
4. Tenant dashboard (1 week)

### Do This Half (Months 4-6)
**Track 3** (25 points). This is the "world's best idea-to-live" differentiator. No competitor has a natural-language → compiled edge site pipeline.
1. MCP `edgegde_generate_layout` tool (1 week)
2. Design token from prompt text (3 days)
3. Self-healing compilation (1 week)
4. Legacy form import (1 week)

### Future (Months 7-12)
**Track 4** (25 points). The revenue multiplier — turns form submissions into an integrated lead management platform.
1. Dynamic form builder UI (2 weeks)
2. Webhook/email integrations (1 week)
3. Lead scoring (3 days)
4. Scheduled reports + exports (1 week)

---

## Part 6: Why Not Execute Yet

| Reason | Detail |
|--------|--------|
| **Hardcoded token is a time bomb** | Anyone who finds the Worker URL can publish malicious layouts. Fix before any new feature. |
| **Dual Zod versions cause subtle bugs** | Schema validation is the backbone of every API boundary. If Zod fails silently, bad data enters the system. |
| **Zero tests = blind deployments** | The mortgage calculator math has no regression tests. A single off-by-one in amortization would cost trust. |
| **Registries don't hydrate on cold start** | Deploying new features while existing tenants can't render is a bad experience. |

Fix these five things first, then every subsequent phase goes faster because you're building on solid ground.
