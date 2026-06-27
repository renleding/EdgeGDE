# EdgeGDE vs Cline, Kilo Code, Crush, Factory — Coding & SDLC Comparison + Improvement Roadmap

**Date:** 2026-06-27  
**Author:** Hermes (Director)  
**Scope:** Compare EdgeGDE's SDLC and coding capabilities against Cline (63.9k ★), Kilo Code (24.8k ★), Crush (25.8k ★), and Factory (~1k ★). Identify EdgeGDE advantages and produce a roadmap to improve coding capability from the existing base.

---

## Part 1: Competitive Landscape

### 1.1 Cline (cline.bot / github.com/cline/cline)
- **Stars/Scale:** 63.9k ★, 6.8k forks, 6,394 commits
- **Form:** VS Code extension + CLI + JetBrains plugin + SDK
- **Key differentiator:** Most popular open-source coding agent. Full product suite: CLI, UI, SDK, Kanban
- **Capabilities:**
  - Multi-model (Anthropic, OpenAI, Gemini, OpenRouter, AWS, Ollama, 15+ providers)
  - Plan/Act mode with human-in-the-loop approval
  - Multi-file coordinated editing + diff review
  - Terminal command execution with real-time output watching
  - `.clinerules` project-specific rules
  - Plugin system + MCP server integration
  - Multi-agent teams (`cline --team-name`)
  - Scheduled/cron agents
  - SDK for building custom agents (`@cline/sdk`)
  - Kanban web-based task board (separate `cline/kanban` repo)
  - Skills system with `.agents/skills/`
  - Checkpoint tracking for undo
  - LSP integration (limited — file-level LSP)

### 1.2 Kilo Code (kilo.ai / github.com/Kilo-Org)
- **Stars/Scale:** 24.8k ★, 2.8k forks
- **Form:** VS Code extension + CLI + Cloud platform
- **Key differentiator:** "All-in-one agentic engineering platform." #1 on OpenRouter by usage. 1.5M+ users, 25T+ tokens processed
- **Capabilities:**
  - VS Code extension AI coding assistant
  - Kilo Cloud (hosted agent runtime)
  - Marketplace for Skills, MCP Servers, and Modes
  - Multi-model support (via OpenRouter, models directly)
  - Terminal-aware agent
  - Plan/Act mode
  - Skills ecosystem

### 1.3 Crush (charmbracelet/crush)
- **Stars/Scale:** 25.8k ★, 1.9k forks, 3,612 commits
- **Form:** Pure CLI (terminal-native), cross-platform
- **Key differentiator:** Charm ecosystem quality. Terminal-first, LSP-enhanced. Cross-platform (macOS, Linux, Windows, Android, FreeBSD, OpenBSD, NetBSD)
- **Capabilities:**
  - Multi-model (Anthropic, OpenAI, Groq, OpenRouter, Vercel, Gemini, 15+ providers)
  - **LSP-integrated** — uses Language Servers for code context (unique among competitors)
  - MCP extensible (http, stdio, sse)
  - Session-based with multiple work sessions per project
  - Switch LLMs mid-session while preserving context
  - Full terminal TUI (not just CLI)
  - No IDE extension — pure terminal

### 1.4 Factory (factory.ai / github.com/Factory-AI/factory)
- **Stars/Scale:** ~1k ★, 42 branches (newer/partially proprietary)
- **Form:** CLI + VS Code + Web + Slack/Teams + Linear/Jira + Mobile
- **Key differentiator:** "Agent-native development platform." Multi-channel. Top-performing in terminal benchmarks. Most enterprise-oriented
- **Capabilities:**
  - Droid CLI agent — "top performing in terminal benchmarks"
  - VS Code extension + JetBrains + Zed (via ACP)
  - Multi-channel: CLI, Web, Slack/Teams, Linear/Jira, Mobile
  - TypeScript + Python SDKs
  - Plugins marketplace
  - GitHub Actions for code review, security scans, PR descriptions
  - ACP protocol support for IDE integration
  - Enterprise integration focus (Linear, Jira, Slack)

---

## Part 2: EdgeGDE Advantages vs Competitors

EdgeGDE occupies a unique position that **none of the four competitors fully cover**:

### ✅ 2.1 Formal SDLC Governance (THE moat)
No competitor enforces a structured SDLC pipeline. EdgeGDE has:

| Feature | EdgeGDE | Cline | Kilo Code | Crush | Factory |
|---------|---------|-------|-----------|-------|---------|
| 5-phase state machine | ✅ Complete | ❌ | ❌ | ❌ | ❌ |
| Role separation (Director/Governance/Executor) | ✅ Explicit | ❌ Single agent | ❌ Single agent | ❌ Single agent | ❌ Single agent |
| Mission Manifest with constraints | ✅ Formal JSON | ❌ | ❌ | ❌ | ❌ |
| Pre-mutation checkpoints + rollback | ✅ Structured | ✅ Basic diff | ❌ | ❌ | ❌ |
| Branch lifecycle policy | ✅ work/{desc} → PR → CI → merge | ❌ | ❌ | ❌ | ❌ |
| Verification gates | ✅ Multi-axis | ❌ | ❌ | ❌ | ❌ |
| Determinism guarantees | ✅ Pure functions + temperature 0.1 | ❌ | ❌ | ❌ | ❌ |

### ✅ 2.2 Multi-Agent Orchestration
EdgeGDE's Kanban board system allows parallel task dispatch to specialist agents with dependency chains, worktree isolation, and goal-mode persistence. Cline has a separate Kanban repo, but no integration with a governance layer.

### ✅ 2.3 Worktree Isolation
EdgeGDE's worktree-subagent-isolation SOP gives every coding task its own isolated git worktree — unique among all four competitors. This prevents context contamination between parallel agents.

### ✅ 2.4 Governance + Execution Boundary
EdgeGDE's Hermes/Aegis/Droid separation means governance and execution are explicitly separated. In all competitors, the coding agent is both planner and executor — there's no independent verification layer.

### ✅ 2.5 Cloudflare Workers-Native Runtime
EdgeGDE runs on CF Workers with Durable Objects, D1, KV, R2 — serverless, globally distributed, append-only audit. Competitors run on your local machine or proprietary cloud. EdgeGDE is the only one built for production deployment, not just development.

### ✅ 2.6 Deterministic Action Lifecycle
FRS-001: Compensation, Replay, Reconcile, Dry-Run — a formal action lifecycle for agent operations. None of the competitors have anything comparable.

### ✅ 2.7 Multi-Executor Flexibility
EdgeGDE can delegate coding to Aider, Claude Code, Codex CLI, or OpenCode — it's not locked to any single executor. Competitors each have their own built-in execution engine.

---

## Part 3: EdgeGDE Coding Capability Gaps (vs Competitors)

Listed in priority order:

### 🔴 Gap 1: No Native Coding Engine (Critical)
EdgeGDE relies on external executors (Aider, Claude Code, Codex). There is no native file-edit, diff-generation, terminal-watching, or LSP-aware coding capability built into Hermes or Droid. This means:
- Every coding task requires an executor handoff (latency)
- No unified execution model (different tools behave differently)
- No coding-specific optimization (context windows, edit strategies)
- No coding benchmarks to measure/publish

**Competitors:** Cline + Kilo Code have native engines. Crush is LSP-enhanced. Factory has benchmark-winning terminal execution.

### 🔴 Gap 2: No IDE Integration
EdgeGDE has no VS Code, JetBrains, or Zed extension. The Hermes agent operates entirely through CLI/terminal.

**Competitors:** Cline has VS Code + JetBrains. Kilo Code has VS Code. Crush is terminal-native (same category but with TUI). Factory has VS Code + JetBrains + Zed.

### 🔴 Gap 3: No LSP or Code Intelligence
EdgeGDE has no Language Server Protocol integration for code context. It reads files raw.

**Competitor:** Crush has LSP integration — it reads LSP diagnostics, completions, and hover info for context. This dramatically improves code-aware edits.

### 🔴 Gap 4: No Coding Benchmarks
EdgeGDE has never been tested on SWE-bench, terminal benchmarks, or any coding evaluation.

**Competitor:** Factory explicitly advertises "top performing in terminal benchmarks."

### 🟡 Gap 5: No Coding-Focused Multi-Model Routing
EdgeGDE uses a fixed model (deepseek-v4-flash) for all coding. No routing strategy for different tasks.

**Competitors:** All four have multi-model support with provider switching.

### 🟡 Gap 6: No SDK for External Integration
EdgeGDE has no SDK for building custom tools, hooks, or integrations. The Hermes agent is the only consumer.

**Competitor:** Cline has `@cline/sdk`, Factory has TS + Python SDKs.

### 🟡 Gap 7: No Coding-Specific Skills/Rules
EdgeGDE has 45+ SDLC skills but no "coding mode" skills with language-specific or framework-specific rules.

**Competitors:** Cline has `.clinerules`. Kilo Code has a marketplace. Crush has LSP (auto language knowledge).

### 🟡 Gap 8: No Multi-Channel Presence
EdgeGDE operates only via CLI/terminal. No Slack/Teams, Linear/Jira, or mobile access.

**Competitor:** Factory is the standout here — Slack/Teams, Linear/Jira, Mobile, Web, and CLI.

---

## Part 4: Improvement Roadmap — From SDLC Governor to Coding Powerhouse

The roadmap is organized into three phases. Each phase has concrete, measurable deliverables.

---

### Phase 1: Foundation (0–3 months) — Close the Critical Gaps

**Goal:** Eliminate dependency on external executors for basic coding. Establish a native coding execution layer.

#### P1.1 — Build Native Droid Coding Engine
- **What:** Droid gets a `code_exec` operation type alongside `read_file`/`write_text`/`shell`
- **Deliverables:**
  - `droid/src/code-editor.ts` — file-aware edit engine with diff generation
  - `droid/src/terminal-watcher.ts` — real-time terminal output monitoring (like Cline)
  - `droid/src/diff-apply.ts` — structured diff-application with validation
  - Mission Manifest extends with `operation: "code_edit"` family
- **Success criteria:** Droid can implement a single-file feature without delegating to Aider/Claude Code
- **Complexity:** Medium (4–6 weeks)

#### P1.2 — Add LSP Integration
- **What:** Hermes reads language server diagnostics and symbol info before editing
- **Deliverables:**
  - `hermes/src/tools/lsp-client.ts` — connects to local LSP servers (typescript-language-server, pyright, etc.)
  - `hermes/src/editing/lsp-context.ts` — injects LSP hover info, diagnostics, completion items into code editing context
  - `hermes/src/editing/lint-on-write.ts` — auto-runs LSP diagnostics after every write
- **Success criteria:** Editing a TypeScript file catches type errors before the agent declares success
- **Complexity:** Medium (3–4 weeks)

#### P1.3 — Create Coding Benchmark Suite
- **What:** Evaluate EdgeGDE's coding capability against a standard benchmark
- **Deliverables:**
  - `benchmarks/swe-bench/` — SWE-bench Lite harness
  - `benchmarks/terminal-bench/` — terminal task harness (like Factory's)
  - Publish results in `docs/CODING-BENCHMARKS.md`
- **Success criteria:** First recorded benchmark numbers — baseline before any optimization
- **Complexity:** Low-Medium (2–3 weeks)

---

### Phase 2: Integration (3–6 months) — IDE, SDK, Multi-Channel

**Goal:** Meet competitors on IDE integration, SDK availability, and channel presence.

#### P2.1 — VS Code Extension (Hermes-IDE)
- **What:** VS Code extension connecting to Hermes agent for in-editor coding
- **Deliverables:**
  - `apps/hermes-ide/` — VS Code extension with:
    - Chat panel (like Cline)
    - Diff review UI for code changes
    - Terminal integration (in-VS Code terminal)
    - File tree awareness
    - Inline code suggestions
  - ACP protocol support (compatible with Factory's approach for JetBrains/Zed)
- **Success criteria:** User can write "add a rate limiter to src/middleware/auth.ts" from inside VS Code and see changes applied with diff review
- **Complexity:** High (8–12 weeks)

#### P2.2 — Hermes SDK
- **What:** Public SDK for building custom tools, hooks, and integrations
- **Deliverables:**
  - `@edgegde/sdk` — TypeScript SDK with:
    - `Agent` class (like Cline's)
    - `createTool` registration
    - Lifecycle hooks (beforeEdit, afterEdit, beforeShell, afterShell)
    - MCP server helper
  - Documentation + example plugins
- **Success criteria:** External developer can build a custom tool that runs inside the Droid engine
- **Complexity:** Medium (4–6 weeks)

#### P2.3 — Multi-Channel: Slack/Linear Bridge
- **What:** Slack/Teams bot and Linear/Jira integration
- **Deliverables:**
  - `packages/hermes-bridge-slack/` — Slack app that receives task requests, creates Kanban tasks
  - `packages/hermes-bridge-linear/` — Linear webhook handler for task creation from issues
  - Kanban task creation from external messages
- **Success criteria:** "Hey @hermes implement this" from Slack creates a Kanban task and dispatches to a worker
- **Complexity:** Medium (4–6 weeks)

#### P2.4 — JetBrains Plugin + Zed Extension
- **What:** Expand IDE support beyond VS Code
- **Deliverables:**
  - JetBrains plugin via ACP protocol
  - Zed extension via ACP protocol
- **Success criteria:** Parity with Cline's JetBrains integration
- **Complexity:** High (6–8 weeks)

---

### Phase 3: Differentiation (6–12 months) — Double Down on EdgeGDE's Strengths

**Goal:** Build capabilities that no competitor has, leveraging EdgeGDE's governance moat.

#### P3.1 — Verifiable Code Generation
- **What:** Every code change comes with a formal verification certificate
- **Deliverables:**
  - TypeScript type-check pass ✅ embedded into every code_edit operation
  - Test-run verification embedded into code_edit workflow
  - Formal proof-of-correctness for deterministic code paths
  - Publish: "EdgeGDE is the only agentic system with verified code generation"
- **Complexity:** High (8–12 weeks)

#### P3.2 — Agentic Code Review
- **What:** Multi-agent code review where Aegis verifies the Droid's output
- **Deliverables:**
  - Review manifest — structured review criteria per PR
  - Automated review via Aegis: style, correctness, security, performance
  - GitHub Status Checks integration for review gate
  - `docs/AGENT-CODE-REVIEW.md` — process documentation
- **Complexity:** Medium (4–6 weeks)

#### P3.3 — Deterministic Replay for Debugging
- **What:** Replay any coding session deterministically, step by step
- **Deliverables:**
  - Droid action log → replay engine
  - Mission Manifest → replay timeline
  - "What if we changed the prompt?" comparison mode
- **Complexity:** High (6–8 weeks)

#### P3.4 — Multi-Model Routing Engine
- **What:** Route coding subtasks to optimal models based on task profile
- **Deliverables:**
  - `packages/model-router/` — routing engine with:
    - Code generation → powerful model (Claude Opus, GPT-5)
    - Lint fixing → fast model (DeepSeek, Gemini Flash)
    - Refactoring → balanced model
    - Test generation → cost-optimized model
  - Cost/quality telemetry per route
- **Complexity:** Medium (4–6 weeks)

#### P3.5 — EdgeGDE Coding Benchmark Publication
- **What:** Publish EdgeGDE's SWE-bench and terminal benchmark scores
- **Deliverables:**
  - Website with scores vs Cline, Kilo Code, Crush, Factory
  - Transparency dashboard (each run's full trace)
  - Iterative improvement cycle (target: top 3 in terminal benchmarks)
- **Complexity:** Low-Medium (2–4 weeks)

---

## Part 5: Summary — Where EdgeGDE Wins

| Dimension | EdgeGDE | Best Competitor | EdgeGDE Action |
|-----------|---------|----------------|----------------|
| **SDLC Governance** | 🏆 Clear Winner | Cline (.clinerules weak) | Maintain — this is the moat |
| **Determinism** | 🏆 Clear Winner | None has it | Formalize + publish |
| **Multi-Agent Orchestration** | 🏆 Leader | Cline (separate Kanban) | Integrate Kanban with coding engine |
| **Worktree Isolation** | 🏆 Unique | None | Maintain + document |
| **Production Runtime** | 🏆 Unique (CF Workers) | None (local-only) | Market this advantage |
| **Native Coding Engine** | ❌ Gap | Cline/Kilo Code | P1.1 — Build Droid Coding Engine |
| **IDE Integration** | ❌ Gap | Cline (3 IDEs) | P2.1 — VS Code Extension |
| **LSP Integration** | ❌ Gap | Crush (LSP) | P1.2 — LSP Client |
| **SDK** | ❌ Gap | Cline (+Factory) | P2.2 — Hermes SDK |
| **Coding Benchmarks** | ❌ Gap | Factory | P1.3 — Benchmarks |
| **Multi-Channel** | ❌ Gap | Factory | P2.3 — Slack/Linear |
| **Verifiable Code** | 🌟 Potential | None | P3.1 — Verify |
| **Replay Debugging** | 🌟 Potential | None | P3.3 — Deterministic Replay |

---

## Part 6: Cost-Benefit — Phase Prioritization

| Priority | Initiative | Est. Effort | Impact | Risk |
|----------|-----------|-------------|--------|------|
| **P0** | Build Native Droid Coding Engine | 4–6 weeks | 🔴 Critical (removes executor dependency) | Medium |
| **P0** | LSP Integration | 3–4 weeks | 🔴 Critical (adds code intelligence) | Low |
| **P1** | Coding Benchmarks | 2–3 weeks | 🟡 High (enables measurement + marketing) | Low |
| **P1** | VS Code Extension | 8–12 weeks | 🟡 High (meets user expectations) | High |
| **P2** | Hermes SDK | 4–6 weeks | 🟡 Medium (enables ecosystem) | Medium |
| **P2** | Slack/Linear Bridge | 4–6 weeks | 🟡 Medium (channel expansion) | Medium |
| **P3** | Verifiable Code Generation | 8–12 weeks | 🏆 Differentiator | High |
| **P3** | Deterministic Replay | 6–8 weeks | 🏆 Differentiator | High |
| **P3** | Multi-Model Routing | 4–6 weeks | 🟡 Medium | Medium |

---

## Scoring Summary

**EdgeGDE's Advantages (score 0–100):**
- SDLC Governance: **95** (unique — no competitor comes close)
- Determinism: **95** (unique)
- Multi-Agent Orchestration: **85** (Cline has partial)
- Worktree Isolation: **95** (unique)
- Production Runtime: **90** (unique — CF Workers)
- Action Lifecycle: **85** (unique — FRS-001)

**EdgeGDE's Gaps (score 0–100, lower = worse):**
- Native Coding Engine: **10** (critical gap)
- IDE Integration: **5** (worst of all compared)
- LSP Integration: **0** (nonexistent)
- SDK: **5** (nonexistent)
- Coding Benchmarks: **0** (nonexistent)
- Multi-Channel: **0** (nonexistent)

**Overall Competitor Comparison:**

| System | SDLC | Coding | IDE | Eco-system | Benchmarks | Production | **Overall** |
|--------|------|--------|-----|-----------|------------|------------|-------------|
| **EdgeGDE** | 95 | 30 | 5 | 15 | 0 | 90 | **39** |
| **Cline** | 25 | 80 | 85 | 75 | 30 | 30 | **54** |
| **Kilo Code** | 15 | 80 | 80 | 70 | 30 | 25 | **50** |
| **Crush** | 5 | 75 | 50 | 40 | 30 | 20 | **37** |
| **Factory** | 20 | 70 | 70 | 65 | 60 | 50 | **56** |

**Key insight:** Factory scores highest overall because it has both coding capability AND enterprise integration. EdgeGDE has a unique governance advantage but is held back by the coding capability gap. Closing that gap (Phase 1) would bring EdgeGDE to parity with Cline/Kilo Code while maintaining governance superiority.

**Recommended next action:** Start Phase 1 immediately — build the Droid coding engine and LSP integration. These have the highest impact-to-effort ratio.
