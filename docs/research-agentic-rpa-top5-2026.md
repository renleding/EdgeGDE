# Top 5 Open Source Agentic RPA Tools for Hermes Integration

**Date:** 2026-07-23  
**Task:** DOC-RES-0002  

---

## Selection Criteria

- **Open source** — MIT/Apache-2.0 preferred
- **Agentic** — AI-driven decision making, not just scripted selectors
- **RPA capabilities** — browser/app automation, workflow orchestration, form filling, data extraction
- **Hermes integrable** — via MCP, CLI, API, or Python SDK

---

## 1. Playwright MCP — ★ Best for Hermes (Native MCP)

| Attribute | Detail |
|-----------|--------|
| **URL** | https://github.com/microsoft/playwright-mcp |
| **License** | Apache-2.0 |
| **Stars** | ~15k+ |
| **Language** | TypeScript (Node.js) |
| **Integration** | **Native MCP server** — Hermes already has native MCP support |

**Why it's #1 for Hermes:**
- **Native MCP protocol** — Hermes can register it as an MCP server in `config.yaml` with zero glue code. Hermes gets 23+ browser automation tools (click, type, snapshot, screenshot, evaluate JS, network intercept) through standardised MCP tool calls.
- **No API key, no hosted tier** — runs 100% locally via `npx @playwright/mcp@latest`. Free.
- **Accessibility-tree based** — uses numbered element refs (`@e2`, `@e5`), same interaction model as Hermes' own cua-driver. Survives DOM changes.
- **Multi-browser** — Chromium, Firefox, WebKit. macOS, Windows, Linux.
- **CLI mode** — 4x fewer tokens than MCP (~27K vs 114K) for filesystem-capable agents

**Limitations:**
- No built-in LLM reasoning — it's a tool provider, not an agent. Hermes provides the reasoning.
- No computer vision (for non-DOM interactions like canvas, CAPTCHA)

**Hermes integration:**
```yaml
# ~/.hermes/config.yaml
mcp_servers:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
    enabled: true
```
Register once → Hermes has full browser automation as tool calls.

---

## 2. Browser Use — ★ Best for Natural Language Automation

| Attribute | Detail |
|-----------|--------|
| **URL** | https://github.com/browser-use/browser-use |
| **License** | MIT |
| **Stars** | **105k** (most-starred AI browser agent) |
| **Language** | Python |
| **Integration** | MCP bridge available (`mcp-browser-use`), Python SDK, REST API |

**Why it's top-tier:**
- **Self-healing automation** — describes intent to LLM, LLM decides how to interact. Survives UI changes without script edits.
- **Computer vision** — uses screenshots with vision LLMs. Can handle CAPTCHAs, canvases, non-standard UI.
- **105k stars** — largest community, most active development (133 releases).
- **$17M funding** (Felicis) — actively maintained by a real company.
- **Cloud option** — hosted browser infrastructure available.

**Limitations:**
- **10-100x slower and more expensive** than scripted automation — every action requires LLM inference.
- Overkill for simple, repetitive tasks that Playwright MCP handles in one tool call.
- Python-only — integration through MCP bridge or subprocess.

**Hermes integration:**
```python
# Via MCP bridge
mcp_servers:
  browser-use:
    # Runs mcp-browser-use as an MCP server
    command: python
    args: ["-m", "mcp_browser_use"]
```

Best for: complex, unstructured web tasks described in natural language. Bad for: high-volume, repetitive workflows where you pay per token.

---

## 3. Skyvern — ⛔ Tested, Not Recommended for Production

| Attribute | Detail |
|-----------|--------|
| **URL** | https://github.com/Skyvern-AI/skyvern |
| **License** | MIT (core), cloud options |
| **Stars** | ~20k+ |
| **Language** | Python |
| **Integration** | REST API, Python SDK |
| **Verdict** | ⛔ Tested — not reliable enough for production automation workflows. Conceptually strong (LLM + CV hybrid), but execution falls short in practice. |

**Why not recommended:** The LLM + computer vision approach sounds good in theory but introduces latency, hallucination risk, and inconsistent results on real-world pages. browser-use (105k stars, active development, MCP bridge) is strictly better for the same use case.

**Hermes integration:** Not recommended. Use browser-use instead.

**Why it's unique:**
- **Purpose-built for RPA** — form filling, multi-step workflows, data extraction. Not just browsing.
- **LLM + Computer Vision hybrid** — reads page structure with AI, uses vision for elements LLMs can't parse. Self-healing.
- **Multi-agent architecture** — sub-agents for navigation, extraction, verification.
- **Enterprise features** — 2FA support, credential management, SOC 2 compliance, session replay.
- **No-code workflow builder** in the cloud version.

**Limitations:**
- Core is OSS but advanced features (managed cloud, no-code builder) are paid.
- Heavier deployment than CLI tools (Python service + browser engine).
- Python-only.

**Hermes integration:**
```python
# Via REST API
POST http://localhost:8000/api/v1/tasks
{
  "workflow": "Fill loan application on Salestrekker",
  "parameters": {"loan_amount": 500000, "applicant": "John Doe"}
}
```

Best for: complex multi-step business processes (loan applications, form-heavy workflows). Overkill for single-page interactions.

---

## 4. Vercel Agent Browser — ★ Best for CLI-First Agents

| Attribute | Detail |
|-----------|--------|
| **URL** | https://github.com/vercel/agent-browser |
| **License** | Apache-2.0 |
| **Stars** | **35k+** (rapid growth) |
| **Language** | Rust CLI + Node.js daemon |
| **Integration** | CLI, Hermes `terminal()` tool, JSON output |

**Why it stands out:**
- **Purpose-built for AI agents** — snapshot-driven interaction model (accessibility tree + numbered refs)
- **Fast** — Rust CLI (~464KB binary), no Python overhead
- **Clean workflow:** `open → snapshot -i --json → click @e2` — maps directly to how Hermes works with cua-driver
- **Session isolation** — run multiple parallel browser sessions with independent cookies/storage
- **Vercel-backed** — actively maintained
- **No LLM inference cost** — deterministic element selection, unlike browser-use

**Limitations:**
- Snapshot-based (accessibility tree), not computer vision — can't handle canvas-heavy apps
- No built-in reasoning — Hermes provides the "what to do next" logic
- Newer project (v0.4.x), API still evolving

**Hermes integration:**
```python
from hermes_tools import terminal

# Open page and get snapshot
result = terminal("agent-browser open https://app.salestrekker.com && agent-browser snapshot -i --json")
snapshot = json.loads(result["output"])

# Click by ref
terminal("agent-browser click @e5")
```

Best for: developers who want fast, deterministic browser automation with a CLI-first workflow. The most natural fit for Hermes' existing terminal-based tool use.

---

## 5. Stagehand — ★ Best for TypeScript/Deterministic Hybrid

| Attribute | Detail |
|-----------|--------|
| **URL** | https://github.com/browserbase/stagehand |
| **License** | MIT |
| **Stars** | **23k+** |
| **Language** | TypeScript |
| **Integration** | MCP, SDK (Node.js/TypeScript), CLI |

**Why it's worth considering:**
- **Bridges the gap** between deterministic Playwright automation and full AI agents
- **Three modes** — `observe()` (extract data from page), `act()` (perform actions), `extract()` (structured data extraction)
- **Backed by Browserbase** — $17M funding, cloud browser infrastructure company
- **Self-healing selectors** — uses AI fallback when primary selector fails, but prefers deterministic paths
- **Token-efficient** — ~4x fewer tokens than browser-use for equivalent tasks

**Limitations:**
- TypeScript-only SDK (Python support experimental)
- Less community adoption than Playwright MCP or browser-use
- Best paired with Browserbase cloud (paid) for production scale

**Hermes integration:**
```yaml
mcp_servers:
  stagehand:
    command: npx
    args: ["@browserbase/stagehand-mcp"]
```

Best for: teams working in TypeScript who want the reliability of Playwright with the flexibility of AI fallback.

---

## Comparison Matrix

| Tool | License | Stars | Lang | Integration | Cost (excl. LLM) | Best For |
|---|---|---|---|---|---|---|
| **Playwright MCP** | Apache-2.0 | 15k+ | TS/Node | **Native MCP** | $0 | Deterministic browser automation via Hermes MCP |
| **browser-use** | MIT | 105k | Python | MCP bridge, CLI | $0 (OSS) + LLM tokens | Natural language, complex web tasks |
| **Skyvern** | MIT | 20k+ | Python | REST API, SDK | $0 (OSS), cloud paid | ⛔ Tested — not recommended. Use browser-use instead. |
| **Agent Browser** | Apache-2.0 | 35k+ | Rust/Node | CLI, Hermes terminal | $0 | Fast CLI-first agent workflows |
| **Stagehand** | MIT | 23k+ | TS | MCP, SDK | $0 (OSS) | TypeScript + deterministic hybrid |

---

## Recommendation for Hermes Stack

### Tier 1 — Install Now
**Playwright MCP** — zero effort integration (native MCP server). Every Hermes session gets 23 browser automation tools. Covers 80% of RPA use cases: login flows, form filling, data extraction, page navigation.

### Tier 2 — Evaluate for Complex Workflows
**browser-use** — for when Playwright MCP's deterministic model fails (dynamic JS, heavy SPAs). Use via MCP bridge or delegate_task. The 105k-star community ensures long-term viability.

**Agent Browser** — add when you need fast CLI-based automation that mirrors cua-driver's ref-model but in headless mode.

### Tier 3 — Enterprise Connectors
**Sema4.ai Action Gallery** — 40+ prebuilt enterprise connectors as MCP servers. Google, Microsoft, Salesforce, HubSpot, ServiceNow, Slack, PDF, Excel. Use for CRM, email, calendar, document operations.

---

## Analysis: Sema4.ai (Formerly Robocorp)

| Attribute | Detail |
|-----------|--------|
| **URL** | https://sema4.ai |
| **License** | Open-source action gallery (MIT) + Enterprise platform (paid) |
| **Stars** | Robocorp ecosystem: ~12k across repos |
| **Language** | Python |
| **Integration** | **Native MCP** support, Python SDK, prebuilt Actions Gallery (40+) |

**What it is:** Sema4.ai is an enterprise AI agent platform built on Robocorp's open-source RPA infrastructure ($25M+ funding, Fortune 500 deployments). It's a **full platform** — not just a browser automation tool.

**Key features relevant to Hermes:**

| Feature | Description |
|---|---|
| **Prebuilt Actions Gallery** | 40+ open-source actions: Google Workspace, Microsoft 365, Salesforce, HubSpot, ServiceNow, Slack, PDF, Excel, Snowflake, YouTube, Zendesk, Linear |
| **MCP Support** | ✅ Native — Studio 1.3.4+ can use MCP servers as actions. Two-way: Hermes can call Sema4.ai actions, Sema4.ai can call Hermes |
| **AI Browsing action** | LLM-powered browser automation (similar to browser-use but as a packaged action) |
| **Agent Connector action** | Hermes ↔ Sema4.ai agent communication |
| **Desktop RPA (Robocorp)** | Legacy RPA engine for desktop app automation — fills the gap browser-only tools miss |
| **Document Intelligence** | PDF parsing, document insights, Snowflake Cortex integration |
| **Snowflake native** | Runs inside Snowflake Cortex with zero-copy data access |

**How Hermes can use it:**

```yaml
# Option 1: Register Sema4.ai actions as MCP servers
mcp_servers:
  sema4-google-mail:
    command: sema4-actions
    args: ["google-mail"]
  sema4-salesforce:
    command: sema4-actions
    args: ["salesforce"]

# Option 2: Agent Connector — two-way agent handoff
# Hermes delegates complex workflows to Sema4.ai agents
# Sema4.ai delegates browser/web tasks to Hermes
```

**Comparison vs Top 5:**

| Dimension | Sema4.ai | Playwright MCP | browser-use |
|---|---|---|---|
| **Category** | Enterprise AI Agent Platform | Browser MCP server | Browser agent framework |
| **Prebuilt connectors** | **40+ enterprise apps** | 0 (browser only) | 0 (browser only) |
| **MCP** | ✅ Native (both directions) | ✅ Native | ⚠️ Bridge |
| **Desktop RPA** | ✅ (Robocorp legacy) | ❌ | ❌ |
| **Self-healing AI** | ✅ Enterprise | ❌ Deterministic | ✅ LLM |
| **Document/PDF** | ✅ Built-in | ❌ | ❌ |
| **Cost** | Free Studio + OSS gallery, paid Control Room | Free | Free + LLM tokens |

**Strengths:**
- **40+ enterprise connectors** out of the box (Google, Microsoft, Salesforce, ServiceNow, HubSpot, Snowflake) — covers what Hermes would need to build individually
- **MCP native** — Hermes can register these as MCP tools with zero glue code
- **Desktop + browser** — the Robocorp legacy means it can automate desktop apps, not just browsers
- **Document intelligence** — built-in PDF parsing, document insights, which ties into the meetily/cal.com pipeline
- **Active company** — $25M funding, Fortune 500 customers, frequent releases

**Weaknesses:**
- **Enterprise-oriented** — full platform (Control Room, orchestration) is paid. The action gallery is open source.
- **Heavier** — requires Studio or Control Room for full capabilities. Individual actions can be run standalone.
- **Complexity** — more to learn than Playwright MCP's single CLI command
- **Vendor dependency** — the platform evolution is driven by enterprise use cases, not individual devs

**Verdict for Hermes stack:**

Sema4.ai is **complementary to, not a replacement for**, the top 5 browser tools. Its value is the **40+ enterprise prebuilt actions** — if you need Google/Microsoft/Salesforce/Snowflake integration, it saves months of building individual connectors. The MCP support makes integration trivial.

**Where it fits:**
- **Tier 2** alongside browser-use and Agent Browser
- Use as a **connector library** (open-source actions, no paid platform needed)
- The AI Browsing action replaces the need for a separate browser-use install
- The Document Intelligence actions could supplement the Meetily pipeline for post-meeting processing

Do not buy the enterprise platform unless you need the orchestration/Control Room features. The open-source action gallery and MCP support are free.

The Simplilearn article lists 5 traditional (non-agentic) RPA frameworks. These predate the AI/LLM wave and rely on **scripted selectors, record-replay, and keyword-driven automation** — not AI reasoning.

| Tool | GitHub | Stars | Lang | Platform | Agentic? | Hermes Fit |
|---|---|---|---|---|---|---|
| **Taskt** | saucepleez/taskt | ~500 | C#/.NET | Windows only | ❌ No | Poor — Windows-only, abandoned |
| **Robot Framework** | robotframework/robotframework | 10k+ | Python | Cross-platform | ❌ No | Medium — keyword-driven, no AI, could script from Hermes terminal |
| **TagUI** | kelaberetiv/TagUI | ~4k | JavaScript | Cross-platform | ❌ No | Dead — no recent updates |
| **Open RPA** | open-rpa/openrpa | ~1.5k | C#/.NET | Windows | ❌ No | Poor — Windows-only |
| **UI.Vision (Kantu)** | A9T9/Kantu | ~1k | JS (browser ext) | Browser + Desktop | ❌ No | Low — no-code only, no API/MCP |

### Why they don't make the top 5 for Hermes

1. **Not agentic** — zero LLM/AI integration. Every workflow is a hard-coded script that breaks when websites change. The agentic tools (browser-use) self-heal through AI.
2. **Windows bias** — Taskt, Open RPA are .NET/Windows only. Hermes runs on macOS.
3. **No MCP support** — none of them implement Model Context Protocol. Integrating requires fragile subprocess/CLI hacks.
4. **Dormant projects** — TagUI has no recent commits. Taskt is effectively abandoned. UI.Vision has minimal updates.
5. **Outdated architecture** — record-replay and CSS selectors are the 2018 approach. Agentic RPA (2025+) uses accessibility trees, vision models, and LLMs.

### The one exception: Robot Framework

Robot Framework is the only one worth a second look — it's actively maintained, has a Python ecosystem, and can be driven from Hermes via:
```python
terminal("robot tests/my_workflow.robot")
```

But it still requires writing Robot Framework DSL (keyword-driven), which is more effort than just calling an MCP tool in Hermes. Use Playwright MCP instead — same reliability, native MCP integration, no DSL to learn.

- https://github.com/microsoft/playwright-mcp
- https://github.com/browser-use/browser-use
- https://github.com/Skyvern-AI/skyvern
- https://github.com/vercel/agent-browser
- https://github.com/browserbase/stagehand
- https://github.com/browser-use/awesome-projects (MCP ecosystem)
- https://www.firecrawl.dev/blog/best-browser-agents (2026 comparison)
- https://www.unbrowse.ai/blog/best-open-source-browser-automation-2026
