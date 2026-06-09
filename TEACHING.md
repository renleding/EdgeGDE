# EdgeGDE — Teaching Layer Map

> A top-to-bottom walkthrough of how the system works, layer by layer.
> Each layer has one job. Layers communicate only through well-defined boundaries.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  LAYER 1 — EMBED / UI                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  WHAT:  Browser iframe with a chat widget                             │   │
│  │  JOB:   Render the chat interface, collect user input, display stream │   │
│  │  FILE:  public/widget.js (v1.0.0, independently versioned)           │   │
│  │  RULE:  Zero business logic. No enforcement. No state.                │   │
│  │         It's a dumb terminal. It sends text and receives tokens.      │   │
│  │  Sandbox: allow-scripts allow-forms  (no allow-same-origin)           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │ HTTPS                                        │
│                              ▼                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LAYER 2 — API GATEWAY (Hono Worker)                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  WHAT:  HTTP endpoints that route requests to the right handler      │   │
│  │                                                                      │   │
│  │  PUBLIC ROUTES:          AUTH              ADMIN ROUTES:              │   │
│  │  /chat/init              tenantQueryAuth    /admin/*                  │   │
│  │  /chat/tool              (validates tenant  /admin/blueprints         │   │
│  │  /chat/stream             exists in KV)    /admin/packs               │   │
│  │  /embed/chat                                /admin/drift              │   │
│  │                                            /admin/site               │   │
│  │                                                                      │   │
│  │  RULE:  Routes parse the request, attach tenant context, and pass    │   │
│  │         down. No processing logic lives here.                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LAYER 3 — PROCESSING PIPELINE (processChatState)                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                                                                      │   │
│  │  This is THE ENGINE. Both streaming and non-streaming paths          │   │
│  │  call the SAME pipeline. No duplicated logic anywhere.               │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  STEP 1: FIELD ENGINE                                          │   │   │
│  │  │  ├─ Which field should we ask about next?                      │   │   │
│  │  │  ├─ Uses: priorityOrder, phase rules, already-collected data   │   │   │
│  │  │  ├─ Pure function — same inputs always give same output        │   │   │
│  │  │  └─ Output: nextField (or COMPLETE if all fields collected)    │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  STEP 2: RULE ENGINE                                          │   │   │
│  │  │  ├─ Do any lending rules trigger given the current data?      │   │   │
│  │  │  ├─ Loads active rules from D1: SELECT * FROM rules WHERE     │   │   │
│  │  │  │   tenant_id = ? AND active = 1                             │   │   │
│  │  │  ├─ Evaluates conditions: LVR > 80%, income < threshold,     │   │   │
│  │  │  │   employment type checks, loan purpose flags               │   │   │
│  │  │  ├─ Output: RuleOutput { stage, flags, required_disclosures } │   │   │
│  │  │  └─ Audit: rule_evaluated (async, fire-and-forget)           │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  STEP 3: COMPLIANCE ENGINE                                     │   │   │
│  │  │  ├─ If rules require disclosures, load the text from KV       │   │   │
│  │  │  │   tenant:{slug}:kb:compliance                              │   │   │
│  │  │  ├─ Matches by disclosure ID → resolves text values           │   │   │
│  │  │  ├─ Injects into LLM prompt: "You MUST include these..."      │   │   │
│  │  │  ├─ This runs BEFORE streaming starts — compliance is         │   │   │
│  │  │  │   never an afterthought                                    │   │   │
│  │  │  └─ Post-stream: validates LLM included them; appends         │   │   │
│  │  │     missing ones if needed (safety net)                       │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  STEP 4: LLM CALL                                             │   │   │
│  │  │  ├─ Sends prompt (KB context + rule context + disclosures)    │   │   │
│  │  │  │   to OpenRouter API (deepseek/deepseek-v4-flash)           │   │   │
│  │  │  ├─ response_format: json_object (forces structured output)   │   │   │
│  │  │  ├─ temperature: 0.1 (near-deterministic)                    │   │   │
│  │  │  ├─ Streaming: relays SSE tokens to client in real-time      │   │   │
│  │  │  └─ After stream: parses full response, extracts fields      │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  STEP 5: POST-PROCESS + AUDIT                                 │   │   │
│  │  │  ├─ applyFieldUpdate: validates + stores collected fields     │   │   │
│  │  │  ├─ Compliance fallback: append any disclosures LLM omitted   │   │   │
│  │  │  ├─ Update D1 session state                                   │   │   │
│  │  │  └─ Audit: disclosure_shown (per disclosure ID, async)        │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  DETERMINISTIC GUARANTEES:                                                    │
│  ├─ Same input → same output (pure functions + low temperature)               │
│  ├─ Rules always enforced (evaluated every turn, not cached)                  │
│  └─ Audit always emitted (fire-and-forget via waitUntil, never blocks)        │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LAYER 4 — DATA STORES                                                       │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────┐  ┌────────────────┐   │
│  │  TENANT KV    │  │  D1 DATABASE    │  │  R2 VAULT │  │  LLM API       │   │
│  │              │  │  ebroker_leads  │  │  BUCKET   │  │  (OpenRouter)  │   │
│  │  tenant:slug │  │                 │  │           │  │                │   │
│  │  :config     │  │  chat_sessions  │  │  KB docs  │  │  deepseek/     │   │
│  │  :kb:        │  │  rules          │  │  uploads  │  │  v4-flash      │   │
│  │  blueprint:  │  │  audit_events   │  │           │  │                │   │
│  │  pack:       │  │  webhook_logs   │  │           │  │                │   │
│  │              │  │                 │  │           │  │                │   │
│  │  guardKV     │  │  upgrade:       │  │           │  │                │   │
│  │  prevents    │  │  snapshot       │  │           │  │                │   │
│  │  unauth'd    │  │  status=pending │  │           │  │                │   │
│  │  writes to   │  │                 │  │           │  │                │   │
│  │  bp+pk       │  │                 │  │           │  │                │   │
│  └──────────────┘  └────────────────┘  └────────────┘  └────────────────┘   │
│                                                                              │
│  KEY RULES:                                                                   │
│  ├─ KV = configuration (tenant configs, blueprints, packs, KB content)       │
│  ├─ D1 = runtime data (sessions, rules, audit trail)                          │
│  ├─ R2 = static assets (file uploads, document storage)                       │
│  └─ guardKV enforces read-only for blueprint/pack keys at the binding level  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LAYER 5 — LOCAL INFRASTRUCTURE                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  OLLAMA SERVER  (http://localhost:11434)                              │   │
│  │                                                                      │   │
│  │  qwen3-vl:4b (3.3 GB, 35 tok/s) ← vision model for Hermes agent    │   │
│  │  ├─ Used for: screenshot analysis, OCR, document image processing   │   │
│  │  ├─ Not part of EdgeGDE runtime — it's a Hermes auxiliary tool      │   │
│  │  └─ Configured via: auxiliary.vision.base_url in ~/.hermes/config   │   │
│  │                                                                      │   │
│  │  Also available: qwen3.5:4b, gemma2:9b, qwen3:4b, llama3.2         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Architecture Principles

### 1. Single Deterministic Pipeline

All chat paths (streaming and non-streaming) go through `processChatState()`:

- **Field engine** decides WHAT to ask next
- **Rule engine** decides IF a rule triggers
- **Compliance engine** decides WHAT disclosures to show
- **LLM** generates natural language WITH those constraints
- **Post-process** validates + audits + stores

This means: no matter how you talk to the system, the SAME rules apply.

### 2. Audit Is the Source of Truth

The chat UI can be wrong. The audit log cannot.

```
rule_evaluated  — every rule evaluation is recorded
disclosure_shown — every disclosure event is recorded
```

Both fire asynchronously (`c.executionCtx.waitUntil`) — never block the response.

### 3. Compliance Before LLM

Disclosures are resolved and injected into the prompt BEFORE the LLM generates tokens. The post-stream compliance fallback is a safety net, not the primary mechanism. This ensures:

- The LLM is aware of compliance requirements at generation time
- Disclosures appear naturally in the stream (not appended awkwardly)
- No race conditions between compliance checks and streaming output

### 4. Versioned Independence

| Component | Version | Bumped By |
|---|---|---|
| EdgeGDE Worker | v0.9.7 | Backend changes |
| Chat Widget | v1.0.0 | Any widget change (text, CSS, JS) |
| UI Builder | v0.1.0 | UI builder changes |

The widget version is a **behaviour contract**. Bump it on ANY change. Never reuse a number. Widget must remain backwards-compatible with the runtime API.

---

## How to Read This Diagram

Start at the top (Layer 1 — the user's browser) and follow the arrows down:

1. User types a message in the widget
2. Widget sends it to the Worker API Gateway
3. Gateway authenticates the request, routes to the right endpoint
4. Processing pipeline runs in order: field → rules → compliance → LLM
5. LLM stream flows back through the gateway to the widget
6. Post-stream: results stored in D1, events recorded in KV, audit logged

Each layer has ONE job. Layers communicate through well-defined interfaces. No layer reaches into another layer's internals.
