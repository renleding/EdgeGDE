# EdgeGDE — Cloudflare Deployment Topology

> How the system maps to Cloudflare's infrastructure.
> Every box is a real Cloudflare product or service.

**System type:** Edge-native deterministic decision system running on Cloudflare Workers.

```
                            INTERNET
                               │
                               ▼
                     ┌──────────────────┐
                     │   CLOUDFLARE     │
                     │   DNS + CDN      │
                     │                  │
                     │ edgegde-         │
                     │ calculator       │
                     │ .renleding       │
                     │ .workers.dev     │
                     └────────┬─────────┘
                              │
                              ▼
               ┌──────────────────────────────┐
               │       CLOUDFLARE WORKER       │
               │    (Hono — TypeScript)        │
               │                               │
               │  ┌─────────────────────────┐  │
               │  │  PUBLIC ENDPOINTS        │  │
               │  │  POST /chat/init        │  │
               │  │  POST /chat/tool        │  │
               │  │  POST /chat/stream      │  │
               │  │  GET  /chat/stream/:id  │  │
               │  │  GET  /embed/chat       │  │
               │  │  GET  /widget.js        │  │
               │  │  GET  /api/v1/models    │  │
               │  └──────────┬──────────────┘  │
               │             │                 │
               │  ┌──────────▼──────────────┐  │
               │  │  AUTH LAYER              │  │
               │  │  ─ tenantQueryAuth       │  │
               │  │    (validates tenant     │  │
               │  │     exists in KV via     │  │
               │  │     query param)         │  │
               │  │  ─ adminAuth             │  │
               │  │    (validates bearer     │  │
               │  │     token)               │  │
               │  │  ─ webhook HMAC          │  │
               │  │    (signature            │  │
               │  │     verification)        │  │
               │  └──────────┬──────────────┘  │
               │             │                 │
               │  ┌──────────▼──────────────┐  │
               │  │  ADMIN ENDPOINTS         │  │
               │  │  /admin/*               │  │
               │  │  /api/tenants           │  │
               │  │  /api/webhook/leads     │  │
               │  │  /api/leads/feed        │  │
               │  └─────────────────────────┘  │
               │                               │
               │  ┌─────────────────────────┐  │
               │  │  DURABLE OBJECT          │  │
               │  │  AuditLedger_DO          │  │
               │  │  (primary event log via  │  │
               │  │   waitUntil — async,     │  │
               │  │   non-blocking)          │  │
               │  │                         │  │
               │  │  ─ real-time SSE        │  │
               │  │    timeline             │  │
               │  │  ─ strongly consistent  │  │
               │  │    event ordering       │  │
               │  └─────────────────────────┘  │
               └──────────────┬───────────────┘
                              │
         ┌────────────────────┼────────────────────┬──────────────────┐
         │  ╔═ READ ════════╗ │  ╔═ READ/WRITE ══╗ │  ╔═ READ ═════╗  │
         ▼  ╚═══════════════╝ ▼  ╚══════════════╝ ▼  ╚════════════╝  ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────────┐  ┌────────────┐
│  CLOUDFLARE KV  │  │  CLOUDFLARE D1  │  │  CLOUDFLARE R2    │  │  LLM LAYER │
│  (TENANT_KV)    │  │  (ebroker_leads)│  │  (VAULT_BUCKET)   │  │            │
│                 │  │                 │  │                   │  │  ┌────────┐ │
│  Global key-    │  │  SQL database   │  │  Object storage   │  │  │ OPEN-  │ │
│  value store    │  │  (read-after-   │  │                   │  │  │ ROUTER │ │
│  10M reads/day  │  │  write)         │  │  kb documents     │  │  │        │ │
│  1M writes/day  │  │                 │  │  file uploads     │  │  │ deep-  │ │
│                 │  │  Tables:        │  │  static assets    │  │  │ seek/  │ │
│  Keys:          │  │  ─ chat_sessions│  │                   │  │  │ v4-    │ │
│  ─ tenant:      │  │  ─ rules        │  │  Located:         │  │  │ flash  │ │
│     {slug}:     │  │  ─ audit_events │  │  ap-southeast-4  │  │  │        │ │
│     config      │  │    (persisted    │  │  (Sydney)        │  │  ├────────┤ │
│  ─ tenant:      │  │     snapshot     │  │                   │  │  │ OLLAMA │ │
│     {slug}:     │  │     of DO log)   │  │                   │  │  │ (local)│ │
│     kb:         │  │  ─ webhook_logs │  │                   │  │  │        │ │
│     compliance  │  │  ─ agents       │  │                   │  │  │ qwen3- │ │
│  ─ tenant:      │  │                 │  │                   │  │  │ vl:4b  │ │
│     {UUID}:     │  │  Located:       │  │                   │  │  │        │ │
│     chat:config │  │  ap-southeast-4 │  │                   │  │  │ vision │ │
│  ─ blueprint:   │  │  (Sydney)       │  │                   │  │  │ only   │ │
│     {id}:latest │  │                 │  │                   │  │  └────────┘ │
│  ─ pack:{name}  │  │                 │  │                   │  └────────────┘
│     _v{version} │  │                 │  │                   │
│                 │  │                 │  │                   │
│  guardKV class  │  │                 │  │                   │
│  blocks writes  │  │                 │  │                   │
│  to blueprint:  │  │                 │  │                   │
│  and pack:      │  │                 │  │                   │
│  prefixes       │  │                 │  │                   │
└────────────────┘  └────────────────┘  └────────────────────┘

│  DATA FLOW KEY:  ───→ synchronous   ─ ─ → async (waitUntil)


╔══════════════════════════════════════════════════════════════════════════════╗
║                         AUDIT ARCHITECTURE                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Audit has TWO layers — they serve different purposes:

  ┌──────────────────────────────────────────────────────────────┐
  │  AuditLedger_DO (Durable Object) — PRIMARY SOURCE OF TRUTH  │
  │                                                              │
  │  ├─ Real-time event stream via SSE (/timeline/stream/:id)    │
  │  ├─ Strongly consistent event ordering (single DO instance)  │
  │  ├─ Written via c.executionCtx.waitUntil (async, non-block) │
  │  └─ Events: rule_evaluated, disclosure_shown                │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  audit_events table (D1) — PERSISTED SNAPSHOT / QUERY LAYER │
  │                                                              │
  │  ├─ Durable, queryable via SQL (JOIN with sessions/rules)    │
  │  ├─ Eventually consistent (written after DO)                 │
  │  ├─ Used for: admin dashboards, audit reports, forensics     │
  │  └─ Not the source of truth — DO is                         │
  └──────────────────────────────────────────────────────────────┘

  Rule: AuditLedger_DO is the source of truth. D1 is the query layer.


╔══════════════════════════════════════════════════════════════════════════════╗
║                         WORKER BINDINGS                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

  These are the environment bindings injected into the Worker at deploy time.
  Configured in wrangler.json.

  ┌──────────────────┬──────────────────────────┬─────────────────────────┐
  │ Binding          │ Resource                 │ Purpose                 │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ TENANT_KV        │ KV Namespace             │ Tenant configs, KB,     │
  │                  │                          │ blueprints, packs       │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ DB               │ D1 Database              │ Runtime data: sessions, │
  │                  │ (ebroker_leads)           │ rules, audit trail      │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ VAULT_BUCKET     │ R2 Bucket                │ Document storage,       │
  │                  │ (edgegde-vault)           │ KB file uploads        │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ AUDIT_DO         │ Durable Object           │ Primary audit event log │
  │                  │ (AuditLedger_DO)          │ (async, waitUntil)      │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ LLM_API_KEY      │ Secret (env var)         │ OpenRouter API key      │
  │                  │                          │ Bearer token            │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ HMAC_KEY         │ Secret (env var)         │ Identity token signing  │
  │                  │                          │ (wrangler secret put)   │
  ├──────────────────┼──────────────────────────┼─────────────────────────┤
  │ WORKER_VERSION   │ Text var                 │ Version identifier for  │
  │                  │                          │ cache-busting + logging │
  └──────────────────┴──────────────────────────┴─────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════════╗
║                       DEPLOYMENT + AUTONOMOUS CORRECTION                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

  ┌──────────────────────────────────────────────────────────────────────────┐
  │                           GITHUB REPOSITORY                               │
  │                      github.com/renleding/EdgeGDE                         │
  │                                                                          │
  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
  │  │  main branch      │  │  work/* branches │  │  hotfix/*        │       │
  │  │  (production)     │  │  (feature)       │  │  (emergency)     │       │
  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘       │
  │           │                     │                       │                │
  │           └──────────────┬──────┴───────────┬───────────┘                │
  │                          │                  │                            │
  │                          ▼                  ▼                            │
  │                    ┌──────────────────────────────────┐                  │
  │                    │  GITHUB ACTIONS (CI/CD)          │                  │
  │                    │                                  │                  │
  │                    │  ├─ bun install (frozen lockfile)│                  │
  │                    │  ├─ bun run typecheck            │                  │
  │                    │  ├─ bun run test                 │                  │
  │                    │  └─ npx wrangler deploy          │                  │
  │                    └──────────────┬───────────────────┘                  │
  │                                   │                                      │
  │                         ┌─────────▼──────────┐                           │
  │                         │  CI PASSED?        │                           │
  │                         └────┬───────────────┘                           │
  │                          YES │             │ NO                          │
  │                              ▼             ▼                              │
  │                    ┌──────────────────────────────────┐                  │
  │                    │  DEPLOY TO WORKER   │  AUTONOMOUS CORRECTION LOOP  │
  │                    │                    │                                │
  │                    │  ├─ wrangler deploy│  ├─ Hermes diagnoses failure  │
  │                    │  ├─ git tag vX.X.X │  ├─ Query Mempalace for       │
  │                    │  └─ smoke test     │  │  similar patterns          │
  │                    │                    │  ├─ Aider generates fix        │
  │                    │                    │  ├─ Re-run CI                 │
  │                    │                    │  ├─ If green → PR auto-update│
  │                    │                    │  └─ If fails → manual branch │
  │                    └────────────────────┴────────────────────────────────┘
  └──────────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════════╗
║                      REGION / LATENCY MAP                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Worker runs at Cloudflare's nearest edge to the user (automatic).
  D1 + R2 are pinned to ap-southeast-4 (Sydney) for Australian mortgage data.

  User (Sydney) ──5ms──→ Cloudflare edge ──5ms──→ D1 (Sydney)
  │                                                  ↓
  └───────────────────────────────────→ OpenRouter (US or closest PoP)

  Total P95 latency: ~2-3s (dominated by LLM API call, not infrastructure)


╔══════════════════════════════════════════════════════════════════════════════╗
║                         SCALING CHARACTERISTICS                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

  ┌────────────────────────────┬────────────────────────────────────────────┐
  │ Component                  │ Scaling behaviour                           │
  ├────────────────────────────┼────────────────────────────────────────────┤
  │ Worker                     │ Infinite (per-request, global edge)         │
  │ KV reads                   │ ~10M/day free tier; 1s global consistency   │
  │ D1 queries                 │ 5M rows/table; 100 concurrent connections   │
  │ Durable Objects            │ Per-fifty-millisecond CPU billing           │
  │ R2 storage                 │ Pay per GB stored + per million operations  │
  │ LLM API (OpenRouter)       │ Pay per token; rate limited by plan        │
  └────────────────────────────┴────────────────────────────────────────────┘
