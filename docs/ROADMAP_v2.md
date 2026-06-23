1|# EdgeGDE Roadmap — Phase-Based Execution Plan
2|
3|> **Version:** 2.0 · **Status:** Approved by Hermes · **Effective:** 2026-06-23  
4|> **Source:** docs/STRATEGIC_REVIEW_v2.md
5|
6|---
7|
8|## Phase 1: Foundation Hardening (NOW — 3 days)
9|
10|| # | Task | Type | Effort | Done? |
11||---|------|------|--------|-------|
12|| 1.1 | Fix `bun` in PATH (broken dev environment) | 🐛 Bug | 5m | ✅ |
13|| 1.2 | Install SigNoz — primary observability backend | 🔧 Infra | 1h | ✅ |
14|| 1.3 | Add dashboard backend (9119) to launchd auto-start | 🔧 Infra | 30m | ✅ |
15|| 1.4 | SDLC automation wired via cron (edgegde-sdlc ci-poll every 5m) | 🚀 Feature | 1h | ✅ |
16|| 1.5 | Review & clear 6 stashes (recover lost agentic-ux code) | ♻️ Cleanup | 30m | ✅ |
17|| 1.6 | Delete deprecated OpenPencil/UIBuilder code | ♻️ Cleanup | 15m | ✅ |
18|| 1.7 | Remove stale remote branches | ♻️ Cleanup | 5m | ✅ |
19|
20|**Exit criteria:** `bun run test` works, SigNoz shows data, SDLC auto-deploys merge.
21|
22|---
23|
24|## Phase 2: Ship to Production (3-5 days)
25|
26|| # | Task | Type | Effort | Done? |
27||---|------|------|--------|-------|
28|| 2.1 | Deploy pipeline exists (6-stage: preflight→artifact→validate→approve→promote→rollback) | 🔧 DevOps | 2h | ✅ |
29|| 2.2 | Deploy v0.9.4 to production (100% traffic) | 🚀 Release | 1h | ✅ |
30|| 2.3 | Create staging environment config template | 🔧 DevOps | 2h | ⏳ |
31|| 2.4 | Production D1 database (ebroker_leads) operational | 🔧 DevOps | 2h | ✅ |
32|| 2.5 | Run compliance-suide + security validation on prod | ✅ QA | 1h | |
33|
34|**Exit criteria:** Production deployment URL works, real tenants can onboard.
35|
36|---
37|
38|## Phase 3: Feature Completion (1-2 weeks)
39|
40|| # | Task | Domain | Effort | Depends On |
41||---|------|--------|--------|-----------|
42|| 3.1 | Calculator Engine MVP (loan repayment, budget planner, stamp duty) | Calculators | 3 days | ✅ |
43|| 3.2 | Agentic UX Runtime Phase 1 (manifest validator, planner, compensation engine) | Agent System | 3 days | ✅ |
44|| 3.3 | Dashboard worktree status card + API endpoint | DevOps | 1h | ✅ |
45|| 3.4 | Langfuse integration for LLM tracing | Observability | 2 days | ⏳ |
46|| 3.5 | Alpha Broker 02 — config inheritance working via stash recovery merge | Tenants | 2 days | ✅ |
47|
48|**Exit criteria:** Calculator works on alpha-broker-01, agentic UX can validate a manifest, LLM traces visible.
49|
50|---
51|
52|## Phase 4: EdgeGDE Excellence (3-4 weeks)
53|
54|| # | Task | Domain | Effort |
55||---|------|--------|--------|
56|| 4.1 | Full calculator catalog (8 types) | Calculators | 2 weeks |
57|| 4.2 | Multi-tenant admin dashboard | Admin UI | 1 week |
58|| 4.3 | Canvas editor PWA v2 (working visual editor) | Canvas | 1 week |
59|| 4.4 | Auto-cleanup config + worktree CLI command | DevOps | 1 day |
60|| 4.5 | Test coverage to 80%+ across all modules | Quality | Ongoing |
61|| 4.6 | Arize Phoenix eval/debug integration | Observability | 1 day |
62|
63|**Exit criteria:** Feature-complete v1.0.0 release.
64|
65|---
66|
67|## Dashboard Status
68|
69|| Service | Port | Current | Target |
70||---------|------|---------|--------|
71|| Workspace UI | 3000 | ✅ launchd | ✅ launchd |
72|| Gateway API | 8642 | ✅ launchd | ✅ launchd |
73|| Dashboard Backend | 9119 | ✅ launchd (fixed Python path + --skip-build) | ✅ launchd |
74|| System Dashboard | 8899 | ❌ Manual | ✅ launchd or cron |
75|| LiteLLM Proxy | 4000 | ✅ Running via Podman | ✅ Verified |
76|| MemPalace | 8888 | ✅ Running via launchd | ✅ launchd |
77|| SigNoz | 8080/4317/4318 | ✅ Running via Docker | ✅ Docker launchd |
78|| Langfuse | — | ❌ MISSING | ✅ Docker/Podman |
79|
80|---
81|
82|## Key Principles
83|
84|1. **Ship before you scope** — No new initiative without a production deployment of current code
85|2. **Complete before you start** — Each phase gates the next
86|3. **Clean as you go** — Every PR should delete more dead code than it creates
87|4. **Visibility drives quality** — If you can't see it, it doesn't exist (SigNoz dashboard)
88|5. **Automate yesterday** — Manual deployment is the root of all deployment fear
89|