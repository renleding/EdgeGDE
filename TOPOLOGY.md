# EdgeGDE — Cloudflare Deployment Topology

> How the system maps to Cloudflare's infrastructure.
> Every box is a real Cloudflare product or service.

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
               │  └─────────────────────────┘  │
               │                               │
               │  ┌─────────────────────────┐  │
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
               │  │  (event log + timeline)  │  │
               │  └─────────────────────────┘  │
               └──────────────┬───────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────────┐
│  CLOUDFLARE KV  │  │  CLOUDFLARE D1  │  │  CLOUDFLARE R2    │
│  (TENANT_KV)    │  │  (ebroker_leads)│  │  (VAULT_BUCKET)   │
│                 │  │                 │  │                   │
│  Global key-    │  │  SQL database   │  │  Object storage   │
│  value store    │  │  (read-after-   │  │                   │
│  10M reads/day  │  │  write)         │  │  kb documents     │
│  1M writes/day  │  │                 │  │  file uploads     │
│                 │  │  Tables:        │  │  static assets    │
│  Keys:          │  │  ─ chat_sessions│  │                   │
│  ─ tenant:      │  │  ─ rules        │  │                   │
│     {slug}:     │  │  ─ audit_events │  │                   │
│     config      │  │  ─ webhook_logs │  │                   │
│  ─ tenant:      │  │  ─ agents       │  │                   │
│     {slug}:     │  │                 │  │                   │
│     kb:         │  │  Located:       │  │  Located:         │
│     compliance  │  │  ap-southeast-4 │  │  ap-southeast-4   │
│  ─ tenant:      │  │  (Sydney)       │  │  (Sydney)         │
│     {UUID}:     │  │                 │  │                   │
│     chat:config │  │                 │  │                   │
│  ─ blueprint:   │  │                 │  │                   │
│     {id}:latest │  │                 │  │                   │
│  ─ pack:{name}  │  │                 │  │                   │
│     _v{version} │  │                 │  │                   │
│                 │  │                 │  │                   │
│  guardKV class  │  │                 │  │                   │
│  blocks writes  │  │                 │  │                   │
│  to blueprint:  │  │                 │  │                   │
│  and pack:      │  │                 │  │                   │
│  prefixes       │  │                 │  │                   │
└────────────────┘  └────────────────┘  └────────────────────┘
         │                    │
         │                    │
         ▼                    ▼
┌─────────────────────────────────────────────────────┐
│                  EXTERNAL NETWORK                     │
│                                                      │
│  ┌──────────────────────┐  ┌────────────────────┐   │
│  │  OPENROUTER           │  │  OLLAMA (local)    │   │
│  │                       │  │                    │   │
│  │  deepseek/            │  │  qwen3-vl:4b       │   │
│  │  deepseek-v4-flash    │  │  (localhost:11434) │   │
│  │                       │  │                    │   │
│  │  response_format:     │  │  Vision only       │   │
│  │  json_object          │  │  (Hermes auxiliary) │   │
│  │                       │  │                    │   │
│  │  temperature: 0.1    │  │  Not part of       │   │
│  │                       │  │  EdgeGDE runtime   │   │
│  └──────────────────────┘  └────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘


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
  │ AUDIT_DO         │ Durable Object           │ Audit event timeline    │
  │                  │ (AuditLedger_DO)          │ with real-time SSE      │
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
║                       DEPLOYMENT ARCHITECTURE                               ║
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
  │                    │  ├─ npx wrangler deploy          │                  │
  │                    │  └─ (autonomous fix loop)        │                  │
  │                    └──────────────┬───────────────────┘                  │
  │                                   │                                      │
  │                                   ▼                                      │
  │                    ┌──────────────────────────────────┐                  │
  │                    │  CLOUDFLARE WORKERS               │                  │
  │                    │  (deployed via wrangler)          │                  │
  │                    │                                  │                  │
  │                    │  ├─ Version: v0.9.7              │                  │
  │                    │  ├─ Routes: *.workers.dev        │                  │
  │                    │  ├─ Tags: git tag + auto-tag     │                  │
  │                    │  └─ Secrets: wrangler secret put │                  │
  │                    └──────────────────────────────────┘                  │
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
