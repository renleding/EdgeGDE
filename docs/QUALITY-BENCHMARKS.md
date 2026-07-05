# EdgeGDE — Codebase Quality Benchmarks & Improvement Plan

**Date:** 2026-07-05  
**Reviewer:** Hermes (Agentic SDLC Director)  
**Scope:** All source code (216 .ts files, 42,576 LOC), all active worktrees, all branches, CI/tooling infrastructure  
**Methodology:** Droid architecture scan → typecheck + test run → governance check → manual file inspection → cross-worktree reconciliation

---

## 1. Quality Benchmarks (Score / 100)

### Type Safety — 52/100 ⚠️

| Metric | Value | Score |
|--------|-------|-------|
| Typecheck errors | **0** | 100 |
| `as any` assertions in source | **408** | 20 |
| `: any` type annotations | **529** | 30 |
| `noUnusedLocals` in tsconfig? | ❌ Not enforced | 40 |

**Breakdown:** Top 10 files with `as any`:

| File | Count | Risk |
|------|-------|------|
| `src/index.ts` | 41 | Entry point — any poisoning propagates |
| `src/api/scoring.ts` | 38 | Core logic — hides real type errors |
| `src/lib/renderer.ts` | 17 | Output rendering |
| `src/api/chat.ts` | 17 | Chat pipeline |
| `src/api/builder.ts` | 16 | Builder engine |
| `src/routes/dashboard.ts` | 14 | Dashboard routes |
| `src/api/submissions.ts` | 14 | Submission handling |
| `src/api/admin-views.ts` | 12 | Admin views |
| `src/api/admin-rules.ts` | 11 | Admin rules |
| `src/edr/compiler/synthesis.ts` | 10 | Compiler engine |

**Critical finding:** `src/index.ts` (the entry point) has 41 `as any` casts. Every untyped value from the entry point cascades type uncertainty through all downstream consumers.

---

### Test Coverage — 85/100 ✅

| Metric | Value | Score |
|--------|-------|-------|
| Unit test files | **65** | 90 |
| Unit tests passing | **598/598** (28 files) | 100 |
| Test : Source ratio | 65 : 216 (30%) | 70 |
| E2E test health | **Pre-existing failures** — gate is non-blocking | 60 |
| Missing test files (gov check) | **0 flagged** | 100 |

**Strengths:** Zero flaky tests, fast suite (~1s). All 598 tests pass reliably.  
**Gaps:** E2E tests are non-blocking with known failures. `admin-integration.test.ts` and `domain-workspace.test.ts` have stale expectations against production.

---

### Code Quality — 70/100 🟡

| Metric | Value | Score |
|--------|-------|-------|
| `console.log` in production | **89 instances** | 40 |
| TODO / FIXME markers | **0** | 100 |
| JSDoc on exports | Partial (governance check doesn't flag yet) | 50 |
| Governance check | PASS (but scanned **0 files** — config issue) | 60 |
| File > 2000 lines | None found | 100 |

**Key concern:** 89 `console.log` calls in production source code. These leak into Cloudflare Workers `wrangler tail` output and pollute structured telemetry. Audit log should replace debug logging.

**Governance check bug:** `npx tsx ../../tools/governance-check.ts` from `apps/edge-runtime/` (how CI runs it) checks **0 files**. Running from root (`npx tsx tools/governance-check.ts`) checks files correctly. The `--diff-only` mode in CI may mask this if there's no diff, but a full scan should be run periodically.

---

### Architecture — 78/100 🟡

| Metric | Value | Score |
|--------|-------|-------|
| Monorepo structure | Clean (`apps/`, `packages/`, `tools/`) | 90 |
| Middleware architecture | Well-organized (auth, tenant, rate-limit, session) | 85 |
| Durable Object pattern | Properly used (ChatSession, CanvasSession, RateLimiter, AuditLedger) | 90 |
| Storage access pattern | Direct env.DB calls bypass tenant guard | 50 |
| Migration management | **19 SQL files, but only 4 registered in wrangler.jsonc** | 40 |

**Architecture gap:** 15 migration files exist on disk but are NOT registered in wrangler.jsonc. This includes migration `0019_add_tutor_progress.sql` (tutor tracking tables) which was never applied to any environment. The gap between committed SQL files and registered migrations is a deployment risk.

**Storage enforcement:** Direct `env.DB.prepare()` and `env.TENANT_KV.get()` calls bypass tenant-context middleware. No wrapper layer enforces tenant isolation.

---

### Dead Code & Tech Debt — 45/100 🔴

| Metric | Value | Score |
|--------|-------|-------|
| Stale worktree (hermes-e1c2d49a) | **136 files changed, -17,784 lines** from main — never merged | 20 |
| Stale remote branches | **6 branches** with unmerged work | 40 |
| Unapplied migration 0019 | Present but not in wrangler config | 30 |
| Untracked build artifacts | Geography PWA files, checkpoints | 60 |
| Empty `pwa-canvas/` dir | Tracked but empty | 50 |

**Critical:** The `hermes-e1c2d49a` worktree holds **17,784 lines of deleted code** vs main. This includes massive deletions of old tools (`saga.py`, `scheduler.py`, `replay.py`), old tests (`uat-calculators.test.ts` — 1,359 lines), old docs (15+ FRS documents), old prompts, and old infra scripts. This work was done local-only and never pushed — if the machine is lost, so is this cleanup effort.

---

### CI/CD & Deploy — 82/100 🟡

| Metric | Value | Score |
|--------|-------|-------|
| CI passes | ✅ **Green** (after today's fixes) | 100 |
| Gates in deploy pipeline | **7 gates**, all run | 80 |
| E2E gate | Non-blocking (known failures) | 50 |
| Governance gate | PASS (0 files — needs fixing) | 60 |
| Auto-deploy on push | ✅ Working | 100 |
| Secrets managed via GH Secrets | ✅ | 100 |

---

### Stale Branches & Unmerged Work — 40/100 🔴

| Branch | Status | Content | Action |
|--------|--------|---------|--------|
| `hermes/hermes-e1c2d49a` (worktree) | Locked, unmerged | 136 files, -17,784 LOC cleanup | **Evaluate and push or discard** |
| `hermes/hermes-e0b8a0b0` | Orphan remote | No commits beyond main | Clean up |
| `work/fix-deploy-queue-consumers` | Remote only | 120 files, -13,892 LOC | Likely superseded by main merges |
| `work/math-tutor-pwa` | Local | Unmerged math tutor PWA work | Assess for completion |
| `work/local-mermaid` (system-control worktree) | Active | 539 files diff, system dashboard | Active — kept for dashboard work |
| `work/fix-*` branches (4 branches) | Remote only | Already merged via squash | **Delete stale remote refs** |

---

## 2. Improvement Implementation Plan

### Priority Matrix

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 🔴 P1 | 408 `as any` in entry point + critical paths | Prevents TS from finding real bugs | 4-6h |
| 🔴 P1 | Migration 0019 not registered + 15 unregistered migrations | D1 schema drift, broken features | 30m |
| 🟡 P2 | Stale worktree (hermes-e1c2d49a) - push or discard | Risk of losing 17K LOC of cleanup | 30m |
| 🟡 P2 | Governance check scans 0 files from CI working dir | False sense of security | 15m |
| 🟡 P2 | 89 `console.log` in production code | Polluted telemetry | 1h |
| 🟡 P2 | E2E test pre-existing failures | Non-blocking gate reduces deploy confidence | 2-3h |
| 🟢 P3 | 6 stale remote branches | Clutters git UI, confuses agents | 5m |
| 🟢 P3 | Direct `env.DB` calls bypass tenant isolation | Cross-tenant leak risk | 2h |
| 🟢 P3 | Untracked geography PWA assets | Should be committed or gitignored | 10m |
| 🟢 P3 | `pwa-canvas/` empty dir | Remove or populate | 5m |

### Phase 1 (Week 1): Foundation — Type Safety + Migration Hygiene

| # | Task | Branch | Est. |
|---|------|--------|------|
| 1 | Cast `src/index.ts` `as any` → typed interfaces (41 occurrences) | `work/type-safety-entry` | 1.5h |
| 2 | Cast `src/api/scoring.ts` `as any` → typed (38 occurrences) | `work/type-safety-scoring` | 1h |
| 3 | Register migration 0019 in wrangler.jsonc + apply | `work/migration-0019` | 30m |
| 4 | Fix governance check to scan from correct working dir | `work/fix-gov-check-cwd` | 15m |
| 5 | Delete stale remote `work/fix-*` branches | — | 5m |

**Exit criteria:** Entry point has 0 `as any`, migration 0019 registered, governance check produces real results.

### Phase 2 (Week 1-2): Code Quality — Logging + E2E Tests

| # | Task | Branch | Est. |
|---|------|--------|------|
| 6 | Replace `console.log` with structured logging (89 sites) | `work/structured-logging` | 1h |
| 7 | Fix E2E test suite (admin-integration + domain-workspace) | `work/fix-e2e-tests` | 2-3h |
| 8 | Restore E2E gate to blocking | (same branch as #7) | — |

**Exit criteria:** E2E gate re-enabled as blocking, zero `console.log` in production code.

### Phase 3 (Week 2-3): Technical Debt — Worktree + Branches

| # | Task | Branch | Est. |
|---|------|--------|------|
| 9 | Evaluate hermes-e1c2d49a worktree — push or discard | `work/worktree-cleanup` | 30m |
| 10 | Clean stale remote branches | — | 5m |
| 11 | Commit or gitignore untracked geography assets | `work/untracked-assets` | 10m |
| 12 | Handle `pwa-canvas/` empty dir | (same branch) | 5m |

**Exit criteria:** All stale branches cleaned, worktree resolved, untracked assets handled.

### Phase 4 (Week 3-4): Architecture — Storage Enforcement

| # | Task | Branch | Est. |
|---|------|--------|------|
| 13 | Create typed D1/KV wrapper with tenant scoping | `work/storage-enforcement` | 1.5h |
| 14 | Migrate top-5 direct `env.DB` call sites to wrapper | (same branch) | 1h |
| 15 | Run cross-tenant isolation audit | — | 30m |

**Exit criteria:** All new DB/KV access goes through tenant-scoped wrappers.

---

## 3. Raw Metrics

| Category | Value |
|----------|-------|
| Source files (.ts) | 216 |
| Source lines | 42,576 |
| Test files (.ts) | 65 |
| Test lines | 14,621 |
| Unit tests | 598 (all passing) |
| D1 migrations (SQL) | 19 |
| Registered migrations | 4 |
| Active worktrees | 3 (main, hermes-e1c2d49a [locked], system-control) |
| Total local branches | 5 |
| Total remote branches | 12 |
| Unmerged branches with content | 2 (hermes branches) + 1 remote (fix-deploy-queue) |
| `as any` occurrences | 408 |
| `: any` type annotations | 529 |
| `console.log` in source | 89 |
| Package version | `0.9.5-dev` |
| Dependencies | 4 runtime + 12 dev |
| Run-time | TypeScript + Hono + Cloudflare Workers |
| CI gates | 7 (1 non-blocking) |
