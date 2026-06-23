# EdgeGDE Roadmap — Phase-Based Execution Plan

> **Version:** 2.0 · **Status:** Approved by Hermes · **Effective:** 2026-06-23  
> **Source:** docs/STRATEGIC_REVIEW_v2.md

---

## Phase 1: Foundation Hardening (NOW — 3 days)

| # | Task | Type | Effort | Done? |
|---|------|------|--------|-------|
| 1.1 | Fix `bun` in PATH (broken dev environment) | 🐛 Bug | 5m | |
| 1.2 | Install SigNoz — primary observability backend | 🔧 Infra | 1h | |
| 1.3 | Add dashboard backend (9119) to launchd auto-start | 🔧 Infra | 30m | |
| 1.4 | Re-create PR for SDLC automation & merge | 🚀 Feature | 1h | |
| 1.5 | Review & clear 6 stashes (recover lost agentic-ux code) | ♻️ Cleanup | 30m | |
| 1.6 | Delete deprecated OpenPencil/UIBuilder code | ♻️ Cleanup | 15m | |
| 1.7 | Remove stale `work/p8-upgrade-fix` branch | ♻️ Cleanup | 5m | |

**Exit criteria:** `bun run test` works, SigNoz shows data, SDLC auto-deploys merge.

---

## Phase 2: Ship to Production (3-5 days)

| # | Task | Type | Effort | Done? |
|---|------|------|--------|-------|
| 2.1 | Add deploy step to CI workflow | 🔧 DevOps | 2h | |
| 2.2 | Deploy v0.9.4 to production | 🚀 Release | 1h | |
| 2.3 | Create staging environment (wrangler --env=staging) | 🔧 DevOps | 2h | |
| 2.4 | Wire up production D1 database | 🔧 DevOps | 2h | |
| 2.5 | Run compliance-suide + security validation on prod | ✅ QA | 1h | |

**Exit criteria:** Production deployment URL works, real tenants can onboard.

---

## Phase 3: Feature Completion (1-2 weeks)

| # | Task | Domain | Effort | Depends On |
|---|------|--------|--------|-----------|
| 3.1 | Calculator Engine MVP (mortgage + budget) | Calculators | 3 days | Calculator spec (done) |
| 3.2 | Agentic UX Runtime Phase 1 (manifest → execution) | Agent System | 3 days | Phase 0 schemas (done) |
| 3.3 | Dashboard worktree status card | DevOps | 1h | Dashboard auto-start (1.3) |
| 3.4 | Langfuse integration for LLM tracing | Observability | 2 days | SigNoz (1.2) |
| 3.5 | Alpha Broker 02 — actual site pages + UI | Tenants | 2 days | Config inheritance (done) |

**Exit criteria:** Calculator works on alpha-broker-01, agentic UX can validate a manifest, LLM traces visible.

---

## Phase 4: EdgeGDE Excellence (3-4 weeks)

| # | Task | Domain | Effort |
|---|------|--------|--------|
| 4.1 | Full calculator catalog (8 types) | Calculators | 2 weeks |
| 4.2 | Multi-tenant admin dashboard | Admin UI | 1 week |
| 4.3 | Canvas editor PWA v2 (working visual editor) | Canvas | 1 week |
| 4.4 | Auto-cleanup config + worktree CLI command | DevOps | 1 day |
| 4.5 | Test coverage to 80%+ across all modules | Quality | Ongoing |
| 4.6 | Arize Phoenix eval/debug integration | Observability | 1 day |

**Exit criteria:** Feature-complete v1.0.0 release.

---

## Dashboard Status

| Service | Port | Current | Target |
|---------|------|---------|--------|
| Workspace UI | 3000 | ✅ launchd | ✅ launchd |
| Gateway API | 8642 | ✅ launchd | ✅ launchd |
| Dashboard Backend | 9119 | ❌ Manual | ✅ launchd |
| System Dashboard | 8899 | ❌ Manual | ✅ launchd or cron |
| LiteLLM Proxy | 4000 | ⚠️ Unknown | ✅ Verified |
| MemPalace | 8888 | ⚠️ Unknown | ✅ launchd |
| SigNoz | — | ❌ MISSING | ✅ Docker launchd |
| Langfuse | — | ❌ MISSING | ✅ Docker/Podman |

---

## Key Principles

1. **Ship before you scope** — No new initiative without a production deployment of current code
2. **Complete before you start** — Each phase gates the next
3. **Clean as you go** — Every PR should delete more dead code than it creates
4. **Visibility drives quality** — If you can't see it, it doesn't exist (SigNoz dashboard)
5. **Automate yesterday** — Manual deployment is the root of all deployment fear
