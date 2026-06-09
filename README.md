# EdgeGDE — Autonomous Mortgage Broker Platform

**Version:** v0.9.7  |  **Runtime:** Cloudflare Workers  |  **Stack:** Hono + TypeScript + D1 + KV + R2

---

## Architecture Overview

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                     EDGEGDE — SOLUTION ARCHITECTURE                        ║
╚══════════════════════════════════════════════════════════════════════════════╝

                          ┌─────────────────────────┐
                          │      BROWSER / EMBED      │
                          │  (widget.js v1.0.0)      │
                          │  iframe sandbox no-origin │
                          └──────────┬──────────────┘
                                     │ HTTPS
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE WORKER (Hono)                                │
│                  edgegde-calculator.renleding.workers.dev                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─── AUTH LAYER ───────────────────────────────────────────────────────┐   │
│  │  tenantQueryAuth (query param → KV)   │   adminAuth (bearer token)   │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────┐   ┌──────────────────────┐                        │
│  │    PUBLIC ROUTES      │   │   ADMIN ROUTES       │                        │
│  │  POST /chat/init      │   │  /admin/*            │                        │
│  │  POST /chat/tool      │   │  /admin/blueprints   │                        │
│  │  POST /chat/stream    │   │  /admin/packs        │                        │
│  │  GET  /chat/stream/:id│   │  /admin/drift        │                        │
│  │  GET  /embed/chat     │   │  /admin/site         │                        │
│  └──────────┬────────────┘   └──────────┬───────────┘                        │
│             │                           │                                    │
│             ▼                           ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │             processChatState()  ← Shared Deterministic Pipeline      │   │
│  │                                                                      │   │
│  │  FieldEngine          RuleEngine           ComplianceEngine          │   │
│  │  ├─ nextField()       ├─ evaluateCondition ├─ disclosures            │   │
│  │  ├─ priorityOrder()   ├─ evaluateRules()   └─ inject before LLM     │   │
│  │  └─ phases()          └─ RuleOutput                                  │   │
│  │                                                                      │   │
│  │  AuditLedger_DO (async, waitUntil — zero latency impact)             │   │
│  │  ├─ rule_evaluated                                                   │   │
│  │  └─ disclosure_shown                                                 │   │
│  │                                                                      │   │
│  │  Deterministic Guarantees:                                           │   │
│  │  ├─ same input → same output                                         │   │
│  │  ├─ rules always enforced                                            │   │
│  │  └─ audit always emitted                                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│             │                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  FACTORY SYSTEM     │  P8 UPGRADE ENGINE                             │   │
│  │  P7: Blueprint→Tenant│  ├─ Dry Run (compatibility check)             │   │
│  │  ├─ validate schema  │  ├─ Execute (atomic D1 batch)                 │   │
│  │  ├─ install packs    │  ├─ Rollback (atomic from snapshot)           │   │
│  │  ├─ detect drift     │  └─ upgrade_status gate (pending→complete)    │   │
│  │  └─ commit config    │                                               │   │
│  └──────────────────────┘  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
              │
    ┌─────────┴─────────┬──────────────┬──────────────────┐
    ▼                   ▼              ▼                  ▼
┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐
│ TENANT   │  │   D1 DATABASE │  │   R2     │  │   LLM API        │
│ KV       │  │  ebroker_leads│  │  VAULT   │  │  (OpenRouter)    │
│          │  │              │  │  BUCKET  │  │                  │
│ tenant:  │  │ chat_sessions│  │  kb docs │  │ deepseek/        │
│ :config  │  │ rules        │  │          │  │ v4-flash         │
│ :kb:     │  │ webhook_logs │  │          │  │                  │
│ blueprint│  │ audit_events │  │          │  │ response_format: │
│ pack:    │  │              │  │          │  │ json_object      │
│          │  │              │  │          │  │                  │
│ guardKV  │  │ upgrade:     │  │          │  │ stream: true     │
│ prevents │  │ snapshot     │  │          │  │                  │
│ unauth'd │  │ status=pending│  │          │  └──────────────────┘
│ access   │  │              │  │          │
│ to bp+pk │  │              │  │          │
└────┬─────┘  └──────┬───────┘  └──────────┘
     │               │
     ▼               ▼
┌──────────────────────────────────────┐
│         LOCAL OLLAMA SERVER          │
│        http://localhost:11434        │
├──────────────────────────────────────┤
│  qwen3-vl:4b (3.3 GB, 35 tok/s)     │
│  └→ Hermes vision_analyze()         │
│  └→ OCR / document analysis         │
│  qwen3.5:4b, gemma2:9b, qwen3:4b   │
└──────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════╗
║                           SDLC + AUTONOMOUS CORRECTION                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

  ┌────────┐  ┌────────┐  ┌────────┐  ┌───────┐  ┌───────┐  ┌────────┐  ┌────────┐
  │ Plan   │→ │ Branch │→ │ Commit │→ │ Test  │→ │  CI   │→ │  PR    │→ │ Merge  │
  │ spec   │  │work/   │  │        │  │ tsx    │  │gh run │  │review  │  │ squash │
  └────────┘  └────────┘  └────────┘  └───────┘  └───────┘  └────────┘  └────────┘
                                                                              │
                         ┌────────────────────────────────────────────────────┘
                         ▼
              ┌──────────────────────────────────────┐
              │     CI FAIL → AUTONOMOUS CORRECTION  │
              │                                      │
              │  Hermes diagnoses → Mempalace stores │
              │  → Aider fixes → re-runs CI          │
              │  → If green, PR auto-updates         │
              └──────────────────────────────────────┘
                         │
                         ▼
              ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
              │ Tag    │→ │ Deploy │→ │Verify  │→ │  Doc   │
              │vX.X.X  │  │wrangler│  │smoke   │  │        │
              └────────┘  └────────┘  └────────┘  └────────┘

╔══════════════════════════════════════════════════════════════════════════════╗
║                        DATA FLOW — STREAMING CHAT                           ║
║           (both /chat/stream and /chat/tool use the same pipeline)          ║
╚══════════════════════════════════════════════════════════════════════════════╝

  User ──→ /chat/stream ──→ Load Session (D1)
                   │
                   ├──→ [RULES] Evaluate D1 rules → RuleOutput
                   │       └──→ audit: rule_evaluated (async, waitUntil)
                   │
                   ├──→ [COMPLIANCE] Resolve disclosure texts from KV
                   │       └──→ Inject into LLM prompt BEFORE streaming
                   │
                   ├──→ [BUILD PROMPT] KB context + rule context + disclosures
                   │
                   ├──→ [STREAM] Fetch LLM (stream: true)
                   │       └──→ SSE ndjson tokens to client
                   │
                   └──→ [POST-STREAM] Parse response
                           ├──→ applyFieldUpdate (constraint engine)
                           ├──→ compliance fallback (append if LLM omitted)
                           ├──→ update D1 session
                           └──→ audit: disclosure_shown (async, waitUntil)

╔══════════════════════════════════════════════════════════════════════════════╗
║                           TEST MATRIX (157+ tests)                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Unit (53)              Integration (36)       E2E + Security (68+)
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
  │ field-engine     │  │ chat-flow        │  │ widget (e2e)        │
  │ rule-engine      │  │ p8-lifecycle     │  │ compliance (e2e)    │
  │ chat-constraint  │  │ compliance       │  │ contract-stream-api │
  │ schema           │  │ admin-integration│  │ security-admin-auth │
  │ upgrade-validator│  │ admin-pages      │  │ audit-events        │
  └──────────────────┘  └──────────────────┘  └──────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════╗
║                         KEY VERSION STREAMS                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

  EdgeGDE Worker:  v0.9.7  (monorepo — apps/edge-runtime + apps/ui-builder)
  Chat Widget:     v1.0.0  (independent — public/widget.js, bumped separately)
  UI Builder:      v0.1.0  (separate app, early stage)

  Widget version = behaviour contract. Bump on ANY change. Never reuse.
  Must be backwards-compatible with runtime API (unless coordinated bump).
```

---

## Quick Start

```bash
cd apps/edge-runtime
cp .env.example .env
bun install
npx wrangler deploy
```

## Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Deep architecture reference |
| [AUDIT.md](./AUDIT.md) | Security audit & compliance |
| [MANIFEST.md](./MANIFEST.md) | System manifest & versioning |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | SDLC workflow & PR guidelines |

## Key Principles

- **Deterministic by design** — field engine, rule engine, compliance engine are pure functions; same input always produces same output
- **Audit over UI** — the audit ledger (`AuditLedger_DO`) is the source of truth, not the chat interface
- **Compliance before LLM** — disclosures are resolved and injected into the prompt before streaming begins; post-stream validation is a safety net
- **SDLC-governed** — all changes flow through `work/` branches → CI → PR → merge → tag → deploy; CI failures trigger an autonomous correction loop (Hermes → Mempalace → Aider)
- **Widget versioned independently** — `widget.js?v=vX.X.X`, bumped on any change, never reused; must be backwards-compatible with runtime API unless both are bumped in coordination
