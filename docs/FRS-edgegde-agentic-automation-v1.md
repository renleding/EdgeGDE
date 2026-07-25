# EdgeGDE Agentic Process Automation Platform — FRS

**Document ID:** FRS-edgegde-agentic-automation-v1  
**Status:** Draft  
**Date:** 2026-07-23  
**Version:** 1.0.0  
**Author:** Hermes (Director)  
**Parent Task:** DOC-FRS-0002  
**Ethos:** EdgeGDE 100/100 — 4 tracks × 25 points toward the best open source agentic RPA platform

---

## 0. Executive Summary

This FRS defines the architecture, components, and roadmap for the **best open source agentic process automation platform in the world** — built on the EdgeGDE stack. It is not a buying guide. It is a **build plan** that combines Hermes (AI orchestration), MCP (universal tool protocol), Playwright MCP (deterministic automation), browser-use (AI-driven fallback), Sema4.ai (enterprise connectors), and Meetily (meeting intelligence) into a single governed system.

The platform follows the EdgeGDE 100/100 ethos: **100 points across 4 tracks, each scoring 25/25 toward production readiness.** Every component is open source, locally-hostable, MCP-native, and governed by Aegis determinism.

---

## 1. Design Philosophy

### 1.1 The EdgeGDE Ethos

The platform is built on six non-negotiable principles derived from the EdgeGDE system model:

| # | Principle | What it means |
|---|-----------|---------------|
| 1 | **Determinism first** | Every automation has an auditable execution trail. No black-box AI decisions. All state transitions are logged. |
| 2 | **MCP as the universal bus** | Every tool, action, and connector is an MCP server. No bespoke integrations. One protocol to rule them all. |
| 3 | **Local-first, privacy-first** | Data sovereignty is non-negotiable. All capture, transcription, and reasoning runs locally. Cloud is optional, never required. |
| 4 | **Aegis governance** | Every action passes through the Director → Governance → Executor pipeline. No ungoverned execution. Saga compensation for failures. |
| 5 | **Cost-conscious AI** | Free local models (Ollama/ornith) for routine reasoning. Paid cloud models only for tasks requiring it. Token efficiency is a feature. |
| 6 | **Open source, forkable** | Every component is MIT/Apache-2.0 licensed. No vendor lock-in. The platform can be forked and run independently. |

### 1.2 The Hybrid Architecture: Deterministic + AI

The key architectural insight: **not every automation step needs AI.** The platform uses a two-tier approach:

```
Task Request
    │
    ▼
┌──────────────────────────────┐
│  Router (Ollama ornith:9b)   │  ← Decide: can this be deterministic?
│  "route to deterministic     │
│   or AI-driven execution?"   │
└──────────┬───────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│ Tier 1  │ │ Tier 2  │
│ Deter-  │ │ AI-     │
│ ministic│ │ Driven  │
├─────────┤ ├─────────┤
│MCP tools│ │browser- │
│Playwr't │ │use      │
│Sema4.ai │ │(vision) │
│Scripts  │ │         │
├─────────┤ ├─────────┤
│$0/token │ │LLM cost │
│2ms/lat  │ │1-5s/lat │
└─────────┘ └─────────┘
```

**Rule:** Use Tier 1 (deterministic) whenever the interaction surface is known and stable. Fall back to Tier 2 (AI) only when the UI is dynamic, unstructured, or vision-dependent. This 80/20 split reduces LLM token costs by ~80% compared to pure-AI approaches.

---

## 2. System Architecture

### 2.1 Component Map

```
                    ┌─────────────────────────────┐
                    │        Hermes (Director)      │
                    │  AI Orchestrator + Router     │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │      Aegis (Governance)       │
                    │  Policy enforcement, logging, │
                    │  Mission Manifests, Saga      │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │    MCP Universal Bus         │
                    │  (Hermes native MCP client)  │
                    └──┬──────┬──────┬──────┬─────┘
                       │      │      │      │
          ┌────────────┘      │      │      └──────────────┐
          ▼                   ▼      ▼                     ▼
   ┌────────────┐   ┌────────────┐ ┌─────────┐   ┌──────────────┐
   │ Playwright │   │ Sema4.ai   │ │browser- │   │ Hermes       │
   │ MCP        │   │ Actions    │ │use MCP  │   │ Native Tools  │
   │ (23 tools) │   │ (40+ conn) │ │(AI nav) │   │ (gmail, crm, │
   │ Determin-  │   │ Enterprise │ │Self-    │   │  calendar,    │
   │ istic      │   │ Connectors │ │healing  │   │  terminal...) │
   └────────────┘   └────────────┘ └─────────┘   └──────────────┘
                                                         │
            ┌────────────────────────────────────────────┘
            ▼
   ┌───────────────┐   ┌──────────────────┐   ┌────────────────┐
   │ Meetily+cal   │   │ Ollama/ornith    │   │ Hermes Native  │
   │ Meeting pipe  │   │ Local AI         │   │ Tools (gmail,  │
   │ Transcript→Act│   │ Trigger + Summ   │   │  crm, term...) │
   └───────────────┘   └──────────────────┘   └────────────────┘
```

### 2.2 MCP Universal Bus

Every component exposes an MCP server. Hermes' native MCP client connects to all of them simultaneously:

```yaml
# ~/.hermes/config.yaml — MCP bus registration
mcp_servers:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
    enabled: true           # Tier 1: deterministic browser automation

  sema4-gallery:
    command: sema4-actions
    args: ["--serve-mcp"]
    enabled: true            # Tier 1: 40+ enterprise connectors

  browser-use:
    command: python
    args: ["-m", "mcp_browser_use"]
    enabled: false           # Tier 2: AI-driven, enable on demand

  meetily-watcher:
    type: script
    path: scripts/meetily-integration/start_watcher.sh
    enabled: true            # Meeting intelligence
```

### 2.3 Agentic Process Automation Definition

For EdgeGDE, "agentic process automation" means:

> An AI-orchestrated system that routes workflow steps through the most appropriate execution engine (deterministic MCP tool or AI-driven agent), governed by auditable policy, with automatic failure compensation, running on local-first infrastructure, costing near-zero for routine tasks.

This is distinct from:
- **Traditional RPA** (UiPath, Automation Anywhere) — scripted selectors, no AI, Windows-bound, expensive per-bot licensing
- **Pure AI Agents** (browser-use, OpenAI Operator) — every action goes through LLM, expensive token burn, no determinism
- **Enterprise AI Platforms** (Sema4.ai, Microsoft Agent Framework) — vendor-locked, cloud-dependent, per-seat pricing

---

## 3. Component Specifications

### 3.1 Hermes — Director & Router

| Spec | Detail |
|---|---|
| Role | AI orchestrator, task router, human interface |
| Integration | Native MCP client, terminal(), delegate_task() |
| AI | DeepSeek V4 Flash (paid) + ornith:9b (local, free) |
| Governance | Aegis 5-phase state machine, Mission Manifests |
| Constraint | Director only — never executes, only routes and verifies |

**Routing logic (priority tree):**
1. Can the task be done with a deterministic MCP tool (Playwright, Sema4.ai, native skill)?
   → Route to Tier 1. Append "use deterministic methods only" to instruction.
2. Is the UI dynamic, canvas-based, or vision-dependent?
   → Route to Tier 2 (browser-use with vision LLM).
3. Is this a multi-step business process (loan app, form-heavy)?
   → Route to Tier 2 (browser-use with vision LLM).
4. Is this a continuous capture/analysis task (meetings, screen)?
   → Route to Meetily pipeline.

### 3.2 Playwright MCP — Tier 1 Deterministic Browser Automation

| Spec | Detail |
|---|---|
| Type | MCP server |
| Tools | 23 (click, type, snapshot, screenshot, eval, network, file upload, etc.) |
| Approach | Accessibility-tree refs (`@e2`, `@e5`) — deterministic, survives DOM changes |
| Cost | $0 (Apache-2.0) + ~114K tokens/MCP or ~27K tokens via CLI |
| Latency | 50-200ms per action |
| Reliability | High — no AI hallucination risk |
| Best for | Form filling, login flows, data extraction from known sites, test automation |

**When to use:** Always first. Covers ~80% of browser automation use cases. The deterministic ref model guarantees repeatable execution — the same instruction produces the same result every time.

### 3.3 browser-use — Tier 2 AI-Driven Fallback

| Spec | Detail |
|---|---|
| Type | Python framework + MCP bridge |
| Approach | LLM decides next action based on page state + screenshot |
| Cost | $0 (OSS) + ~$0.08-$0.35/task in LLM tokens |
| Latency | 1-5s per action |
| Reliability | Variable — depends on LLM quality and page complexity |
| Best for | Unstructured pages, CAPTCHA handling, non-standard UI, canvas apps |

**When to use:** Only when Playwright MCP's deterministic approach fails. The router (ornith:9b) decides when escalation is needed.

### 3.4 Sema4.ai Action Gallery — Enterprise Connectors

| Spec | Detail |
|---|---|
| Type | Open-source action packages (Python) |
| Connectors | 40+ (Google, Microsoft 365, Salesforce, HubSpot, ServiceNow, Slack, PDF, Excel, Snowflake, Linear, Zendesk) |
| Auth | OAuth2, API keys, SMTP credentials |
| License | MIT (actions), Enterprise (platform) |
| Integration | Native MCP via `--serve-mcp` flag |
| Best for | CRM, email, calendar, document operations — anything that has an API |

**Value to Hermes:** These are pre-built MCP servers for enterprise apps. Without them, each integration (Google Mail, Salesforce, ServiceNow) would need a custom MCP server built from scratch. With them, it's one config line each.

### 3.5 Meetily + cal.com — Meeting Intelligence Pipeline

Covered in detail in `FRS-meetily-cal-integration-v1.md`. Key points:
- Meetily captures system audio (invisible, no bot)
- SQLite watcher detects completed transcripts
- Ollama (ornith:9b, qwen3-vl:4b) extracts triggers and summaries
- Actions dispatch to cal.com (bookings), email, CRM, MemPalace

### 3.7 Ollama — Local AI Layer

| Spec | Detail |
|---|---|
| Models | ornith:9b (trigger extraction, routing), qwen3-vl:4b (summarisation) |
| Role | Cost-free tier for routine reasoning |
| Fallback | DeepSeek V4 Flash (paid) for complex tasks ornith:9b can't handle |
| Cost | $0 (local inference) |

### 3.8 Aegis — Governance & Determinism

| Spec | Detail |
|---|---|
| Role | Policy enforcement, audit logging, Saga compensation |
| Invariants | Every automation has a Mission Manifest. Every mutation has a checkpoint. Every failure has a compensation path. |
| Logging | `.hermes/logs/missions/` — structured JSON per run |
| Validation | Post-execution verification: diffs match expectations, no scope creep, all compensations logged |

---

## 4. Execution Model

### 4.1 Task Lifecycle

```
User Request (or cron trigger)
    │
    ▼
1. DISCOVERY — Hermes assesses the request: can it be automated?
    │           What tools are needed? What are the risks?
    ▼
2. ALIGNMENT — Mission Manifest created: tasks, compensations, constraints
    │
    ▼
3. GATE — Await "gogo" for autonomous execution
    │
    ▼
4. EXECUTION — Router decides Tier 1 (deterministic) or Tier 2 (AI)
    │           ▶ MCP tool call (Playwright, Sema4.ai)
    │           ▶ delegate_task (browser-use)
    │           ▶ terminal script (custom automation)
    ▼
5. VERIFICATION — Aegis checks: diffs match, no violations, all compensations run
    │
    ▼
Done. Report with structured summary.
```

### 4.2 Trigger Sources

| Source | Mechanism | Example |
|---|---|---|
| User command | Chat prompt ("automate this process") | "Extract loan data from Salestrekker daily" |
| Cron schedule | Hermes cron job | Every Mon 9am: generate weekly report |
| Webhook | Incoming HTTP | cal.com booking created → process meeting |
| File watcher | FSEvents | New meeting transcript → dispatch actions |

### 4.3 Failure Model (Saga Compensation)

Every multi-step automation has a compensation plan:

```json
{
  "mission_id": "aut-001",
  "tasks": [
    {
      "id": "step_1_log_in",
      "operation": "mcp_tool",
      "tool": "playwright",
      "compensate": {"action": "logout_and_clear_session"}
    },
    {
      "id": "step_2_extract_data",
      "operation": "mcp_tool",
      "tool": "playwright",
      "compensate": {"action": "noop"}  // Read-only, no compensation needed
    },
    {
      "id": "step_3_update_crm",
      "operation": "api_call",
      "tool": "sema4-salesforce",
      "compensate": {"action": "undo_last_update"}
    }
  ],
  "compensation_strategy": "reverse_order"
}
```

---

## 5. The 100/100 Roadmap

Four tracks, 25 points each. Total: 100/100. Each point represents a concrete, verifiable capability.

### Track 1: Foundation & Infrastructure (25/25)


| # | Milestone | Points | What It Enables |
|---|---|---|---|
| 1 | MCP bus operational: Playwright MCP registered in Hermes config | 3 | Deterministic browser automation from any Hermes session |
| 2 | Sema4.ai action gallery served as MCP | 3 | 40+ enterprise connectors as MCP tools |
| 3 | Router (ornith:9b) classifying tasks as Tier 1 vs Tier 2 | 3 | Cost-aware task routing — 80% of tasks go deterministic |
| 4 | Aegis Mission Manifest generation for every automation run | 3 | Auditable execution trail for every task |
| 5 | Saga compensation engine operational | 3 | Automatic rollback on failure — never stuck state |
| 6 | Terminal-based Hermes cron for scheduled automations | 2 | Recurring tasks without user oversight |
| 7 | launchd agents for all daemons (watcher, screenpipe, meetily) | 2 | Auto-start on login, auto-restart on crash |
| 8 | .env.example with all service credentials documented | 1 | New dev setup in minutes |
| 9 | Memory: all service ports, paths, and configs saved | 1 | No "where is X running?" questions |
| 10 | Verification: `hermes health --automation` checks all services | 4 | One command confirms the entire stack is up |

**Total: 25/25**

### Track 2: Browser & Desktop Automation (25/25)

| # | Milestone | Points | What It Enables |
|---|---|---|---|
| 1 | Playwright MCP: navigate, click, type, snapshot, screenshot | 3 | Core browser interaction from MCP |
| 2 | Playwright MCP: form filling with structured data injection | 3 | Automated data entry into web apps |
| 3 | Playwright MCP: file upload/download automation | 2 | Document workflows (PDF upload, report download) |
| 4 | Playwright MCP: evaluate JavaScript for state extraction | 2 | Handle SPAs, React apps that don't render in AX tree |
| 5 | browser-use MCP bridge registered (disabled by default) | 3 | AI-driven fallback available when deterministic fails |
| 6 | Router triggers browser-use automatically on Tier 1 failure | 3 | Seamless escalation without user noticing |
| 7 | browser-use for multi-step business processes | 3 | Loan applications, multi-page forms with attachments |
| 8 | Session isolation: parallel browser sessions with independent state | 2 | Run multiple automations simultaneously |
| 9 | Screenshot evidence attached to Mission Manifest logs | 2 | Visual audit trail for every automation run |
| 10 | Login credential injection from Bitwarden vault | 2 | Zero plaintext credentials in automation scripts |

**Total: 25/25**

### Track 3: Enterprise Connectors & Data Pipeline (25/25)

| # | Milestone | Points | What It Enables |
|---|---|---|---|
| 1 | Sema4.ai Google Mail action as MCP tool | 2 | Send/read emails from automation |
| 2 | Sema4.ai Google Calendar action as MCP tool | 2 | Create calendar events from triggers |
| 3 | Sema4.ai Microsoft 365 Calendar action as MCP tool | 2 | Outlook calendar integration |
| 4 | Sema4.ai Salesforce action as MCP tool | 2 | CRM read/write from automations |
| 5 | Sema4.ai HubSpot action as MCP tool | 2 | Alternative CRM support |
| 6 | Sema4.ai PDF action as MCP tool | 2 | Extract text, parse documents |
| 7 | Meetily SQLite watcher + Ollama trigger extraction | 4 | Meeting intelligence pipeline |
| 10 | cal.com API v2 booking creation from action triggers | 2 | Auto-schedule follow-ups |
| 11 | MemPalace/LadybugDB persistence for all automation records | 2 | Searchable knowledge base of all automations |

**Total: 25/25**

### Track 4: Intelligence, Governance & Scale (25/25)

| # | Milestone | Points | What It Enables |
|---|---|---|---|
| 1 | Router accuracy ≥95%: ornith:9b correctly classifies Tier 1 vs Tier 2 | 3 | Cost savings from correct routing |
| 2 | Aegis policy enforcement: no automation runs without Mission Manifest | 3 | Zero ungoverned execution |
| 3 | Saga compensation verified: every multi-step task has compensation path | 3 | No stuck state on any failure |
| 4 | Token cost tracking per automation run | 2 | Cost visibility — know what each automation costs |
| 5 | Ollama-only mode: all AI runs locally, zero API calls | 2 | Air-gapped operation capability |
| 6 | Multi-tenant: Hermes profiles with isolated automation configs | 2 | Separated work/personal automation stacks |
| 7 | Automation library: reusable, versioned automation recipes | 3 | Share and reuse common workflows |
| 8 | Health dashboard: one-page view of all automation services | 2 | Operations visibility |
| 9 | Failure alerts: Telegram/email notification on automation failures | 2 | Proactive monitoring |
| 10 | Benchmark: 100 automated test runs with 100% determinism on Tier 1 | 3 | Proof of reliability |

**Total: 25/25**

---

## 6. Comparison to Other Solutions

| Dimension | EdgeGDE Platform | UiPath | Automation Anywhere | Sema4.ai Enterprise | Browser Use alone |
|---|---|---|---|---|---|
| Open source | ✅ All MIT/Apache | ❌ Proprietary | ❌ Proprietary | ⚠️ Actions OSS, platform paid | ✅ MIT |
| Deterministic + AI hybrid | ✅ Built-in router | ❌ Script-only | ❌ Script-only | ✅ Platform manages | ❌ AI-only |
| Local-first | ✅ Everything local | ❌ Cloud-dependent | ❌ Cloud-dependent | ⚠️ Studio local, Control Room cloud | ✅ Local |
| MCP native | ✅ Universal bus | ❌ No | ❌ No | ✅ MCP supported | ⚠️ Bridge |
| Cost for routine tasks | ~$0 (local models) | $15k+/yr per bot | $12k+/yr per bot | Enterprise pricing | $0 + LLM tokens |
| Governance | ✅ Aegis (5-phase, Saga) | ⚠️ Basic logging | ⚠️ Basic logging | ✅ Platform-level | ❌ None |
| Desktop automation | ✅ via Playwright + MCP | ✅ Full desktop | ✅ Full desktop | ✅ via Robocorp | ❌ Browser only |
| Meeting intelligence | ✅ Meetily | ❌ No | ❌ No | ⚠️ Document AI only | ❌ No |
| Forkable | ✅ All repos forkable | ❌ No | ❌ No | ⚠️ Actions only | ✅ Forkable |

---

## 7. Cost Analysis

| Component | Cost | Notes |
|---|---|---|
| Hermes (DeepSeek V4 Flash) | ~$0.50-2/day | Paid model for complex reasoning |
| Ollama (ornith:9b, qwen3-vl:4b) | $0 | Local inference, no API calls |
| Playwright MCP | $0 | Apache-2.0, no tiers |
| browser-use | $0 | MIT + ~$0.08-0.35/task when used |
| Sema4.ai Action Gallery | $0 | MIT |
| Meetily | $0 | MIT Community Edition |
| cal.com | $0 | Free plan |
| Infrastructure (macOS) | Already owned | Runs on Warren's Mac |

**Monthly cost:** ~$15-60/month (mostly DeepSeek tokens). Compared to UiPath ($1,250+/month per bot) or Automation Anywhere ($1,000+/month), this is **2-4% of enterprise RPA cost** with greater capability.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sema4.ai enterprise pivot deprecates open-source actions | Low | Medium | Fork the gallery repo. All actions are MIT-licensed. |
| Playwright MCP API changes | Low | Low | Pin version in Hermes config. |
| browser-use LLM token costs spiral | Medium | Medium | Router minimizes usage. Set budget cap per automation. |
| Meetily DB schema changes in v0.5+ | Medium | Medium | Pin Meetily version. Schema-adaptive queries in watcher. |
| Ollama model quality insufficient for routing decisions | Low | Medium | Fallback to Hermes' DeepSeek for routing when confidence < 90%. |

---

## 9. Implementation Phases

### Phase 1 — Core MCP Bus (Week 1)
- Register Playwright MCP in Hermes config
- Register Sema4.ai action gallery as MCP server
- Verify all tools accessible from Hermes `mcp_list`
- Router prototype: ornith:9b classifies sample tasks

### Phase 2 — Deterministic Automation (Week 2)
- Build 5 reference automations using Playwright MCP (login, form fill, data extract, file upload, logout)
- Test all 23 Playwright MCP tools
- Implement Aegis Mission Manifest generation for MCP tool calls
- Session isolation for parallel automation runs

### Phase 3 — AI-Driven Fallback (Week 3)
- Register browser-use MCP bridge
- Build router escalation: Tier 1 failure → auto-retry with browser-use
- Test with dynamic/non-standard UI pages
- Implement token cost tracking

### Phase 4 — Enterprise Connectors (Week 4)
- Configure Sema4.ai actions: Google Mail, Calendar, Salesforce, PDF
- OAuth2 credential setup for each connector
- Build reference automation: "extract email attachment → parse PDF → create CRM task"

### Phase 5 — Meeting Intelligence (Week 5)
- Complete Meetily/cal.com pipeline (from FRS-meetily-cal-integration-v1.md)
- Pipe: "meeting ended → process transcript → dispatch actions"

### Phase 6 — Governance & Production Readiness (Week 6)
- Benchmark: 100 deterministic runs, 100% pass rate
- Failure alerts via Telegram
- Health dashboard
- Automation library: save 10 reference automations

---

## 10. Definitions

| Term | Definition |
|---|---|
| **Agentic Process Automation** | AI-orchestrated system that routes tasks through deterministic or AI-driven execution engines, governed by auditable policy |
| **Tier 1 (Deterministic)** | MCP tools that produce the same result every time — no AI inference required. Playwright MCP, Sema4.ai actions, scripted tools. |
| **Tier 2 (AI-Driven)** | Tools that use LLM inference to decide each action. browser-use. Used as fallback only. |
| **MCP Universal Bus** | Hermes' native MCP client connecting to all service MCP servers simultaneously. One protocol, many tools. |
| **100/100** | EdgeGDE measurement: 4 tracks × 25 points = production readiness score. 100 means the platform is complete. |
| **Saga Compensation** | Pattern for rolling back multi-step automations on failure. Compensations run in reverse order. |

---

## 11. Sources

- AGENTS.md — EdgeGDE project contract
- FRS-meetily-cal-integration-v1.md — Meeting intelligence pipeline
- docs/research-agentic-rpa-top5-2026.md — RPA tool research
- https://github.com/microsoft/playwright-mcp
- https://github.com/browser-use/browser-use
- https://github.com/Sema4AI/gallery
- https://github.com/screenpipe/screenpipe
- https://github.com/Zackriya-Solutions/meetily
- https://cal.com/docs/api-reference/v2
