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
│                        CLOUDFLARE WORKER (Hono)                             │
│                     edgegde-calculator.renleding.workers.dev                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐   ┌──────────────────────┐                        │
│  │    CHAT ENDPOINTS     │   │   ADMIN ENDPOINTS    │                        │
│  │  POST /chat/init      │   │  /admin/*            │                        │
│  │  POST /chat/tool      │   │  /admin/blueprints   │   adminAuth (token)   │
│  │  POST /chat/stream    │   │  /admin/packs        │                        │
│  │  GET  /chat/stream/:id│   │  /admin/drift        │                        │
│  │                       │   │  /admin/site         │                        │
│  │  tenantQueryAuth (kv) │   └──────────┬───────────┘                        │
│  └──────────┬────────────┘              │                                    │
│             │                           │                                    │
│             ▼                           ▼                                    │
│  ┌──────────────────────┐   ┌──────────────────────┐                        │
│  │    CHAT PROCESSING    │   │   FACTORY SYSTEM     │                        │
│  │                       │   │  P7: Blueprint→Tenant│                        │
│  │  FieldEngine          │   │  P8: Pack Upgrade    │                        │
│  │  ├─ nextField()       │   │  ├─ Dry Run          │                        │
│  │  ├─ priorityOrder()   │   │  ├─ Execute (batch)  │                        │
│  │  └─ phases()          │   │  ├─ Rollback (batch) │                        │
│  │                       │   │  └─ Snapshot         │                        │
│  │  RuleEngine           │   └──────────────────────┘                        │
│  │  ├─ evaluateCondition()│                                                │
│  │  ├─ evaluateRules()   │                                                │
│  │  └─ RuleOutput        │                                                │
│  │                       │                                                │
│  │  ComplianceEngine     │                                                │
│  │  ├─ disclosures       │                                                │
│  │  └─ audit logging     │                                                │
│  │                       │                                                │
│  │  AuditLedger_DO       │                                                │
│  │  ├─ rule_evaluated    │                                                │
│  │  └─ disclosure_shown  │                                                │
│  └──────────┬────────────┘                                                │
│             │                                                              │
└─────────────┼──────────────────────────────────────────────────────────────┘
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
│ blocks   │  │ snapshot     │  │          │  │                  │
│ blueprint│  │ status=pending│  │          │  └──────────────────┘
│ & pack   │  │              │  │          │
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
║                              SDLC PIPELINE                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝

  ┌────────┐  ┌────────┐  ┌────────┐  ┌───────┐  ┌───────┐  ┌────────┐  ┌────────┐
  │ Plan   │→ │ Branch │→ │ Commit │→ │ Test  │→ │  CI   │→ │  PR    │→ │ Merge  │
  │ spec   │  │work/   │  │        │  │ tsx    │  │gh run │  │review  │  │ squash │
  └────────┘  └────────┘  └────────┘  └───────┘  └───────┘  └────────┘  └────────┘
                                                                              │
                                                                              ▼
                                      ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
                                      │ Tag    │→ │ Deploy │→ │Verify  │→ │  Doc   │
                                      │vX.X.X  │  │wrangler│  │smoke   │  │        │
                                      └────────┘  └────────┘  └────────┘  └────────┘

╔══════════════════════════════════════════════════════════════════════════════╗
║                        DATA FLOW — STREAMING CHAT                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

  User ──→ /chat/stream ──→ Load Session (D1)
                   │
                   ├──→ [Rules Mode] Evaluate D1 rules → RuleOutput
                   │       ├──→ disclosureTexts from KV
                   │       └──→ audit: rule_evaluated
                   │
                   ├──→ Build LLM Prompt (KB + rules + disclosures)
                   │
                   ├──→ [Stream Mode] Fetch LLM (stream: true)
                   │       └──→ SSE ndjson tokens to client
                   │
                   └──→ [Post-Stream] Parse response
                           ├──→ applyFieldUpdate
                           ├──→ compliance fallback
                           ├──→ update D1 session
                           └──→ audit: disclosure_shown

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
  Chat Widget:     v1.0.0  (independent — public/widget.js)
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

- **Deterministic by design** — field engine, rule engine, compliance engine are pure functions
- **Audit over UI** — the audit ledger is the source of truth, not the chat interface
- **SDLC-governed** — all changes flow through `work/` branches → CI → PR → merge → tag → deploy
- **Widget versioned independently** — `widget.js?v=vX.X.X`, bumped on any change, never reused
