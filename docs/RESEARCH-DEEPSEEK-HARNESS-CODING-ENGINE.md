# Generic Agent Harness as EdgeGDE Coding Engine — Feasibility Research

**Date:** 2026-08-21
**Author:** Hermes (Director)
**Card:** DOC-RES-034
**Question:** Should a generic, provider-agnostic agent harness become the coding engine for EdgeGDE, with Hermes remaining the director and general-purpose agent framework?

**Provider stance (Warren directive):** EdgeGDE uses **no DeepSeek models or services**. The harness candidate (dsh) is studied purely as a MIT-licensed, provider-neutral runtime — its default DeepSeek adapter is optional and unused. All model routing goes through our existing stack: **ornith:9b local (Ollama) → OpenRouter free-tier via LiteLLM (:4000)**.

---

## 1. What the candidate is

- **`dsh`** = open-source (MIT) agent harness, released 2026-08-13. 176k★ / 19k forks, ~13k commits, active daily pushes. **Developer preview** (explicit warning: breaking changes ahead).
- Built on **Cordis** (plugin meta-framework, "A Programming Paradigm for Spatiotemporal Composability"). **Everything is a plugin**: models, tools, skills, sessions, sandboxes, filesystems, loops, scheduling, UI. No privileged core to patch — extension means mounting a plugin beside the others.
- **Agent = Model + Harness.** The harness is the runtime; the model is swappable. Provider-neutral by design: ships a generic multi-provider adapter (pi-ai) covering Ollama, OpenRouter, OpenAI, Anthropic, and **any OpenAI-compatible gateway** (LiteLLM included) — no code change, just config.
- **Every run is traceable**: append-only `SessionEvent` log (turn/step/tool events, system prompts, reasoning, tool calls/results, context injections — "model-visible ⟺ logged" is a runtime invariant). Trajectory view, resume, fork, search, replay all derive from that one stream.

### Capability surface relevant to us (verified from source)

| Package | What it gives us |
|---|---|
| `core/session` | Append-only typed event log = **built-in audit trail** (source of truth; LLM history is derived, replayable) |
| `core/tools` | Typed tool registry + **pre-execute allow/deny/ask waterfall**, post-execute inspect/replace, per-scope `ToolRestriction` allow/deny filters |
| `llm/` | **LLM capability seam** + pi-ai adapter (any provider/gateway); provider-scoped retryPolicy; replay-aware token meter; reasoning-effort mapping |
| `subagent/` | Execution seam: in-process spawn/fork, out-of-process over ACP, real Codex child, real Claude Code child (optional bundles) |
| `acp/` | Automation-only Agent Client Protocol server (JSON-RPC) = deterministic programmatic control channel for Hermes |
| `sdk/` | JSON-RPC protocol, server, TypeScript client; **Python SDK** for benchmarks |
| `bundle/headless` | One-shot no-server runner: `dsh --profile headless "task"` → prints result, exit 0/1. Perfect Droid-style automation |
| `fs/ shell/ terminal/` | Filesystem policy, bash/pwsh, persistent terminals — sandboxable |
| `lsp/` | **Language-server capability**: headless LSP as a validation gate (our stance since 2026-06-27) |
| `guard/` | Loop-hygiene: repeat-tool reminders, tool-call timeout policy |
| `hooks/` | External shell-hook bridge protocol |
| `skill/` | Skill provider registry + catalog/loader tool |
| `workflow/` | Workflow capability + worker-thread provider |
| `preset/` | Per-session agent composition (tools + persona as rows) |
| `interaction/` | Approval, permission presets, commands, ask-user — HITL seams |
| `compaction/`, `context/` | Context compaction + request-context plugins |
| `e2b/` | Remote sandbox adapters (POC) |

**Same-class alternatives** (if we reject the dsh codebase itself): OpenHands, SWE-agent, Cline headless (`@cline/sdk`), Crush (terminal-native, LSP-aware). All weaker on (a) MIT plugin-composability of the *whole* runtime and (b) first-class audit-log/replay primitives — see DOC-RES-0001 competitive scoring. dsh is the reference implementation; the recommendation below is the **generic pattern**, portable to any of them.

### Known real-world behavior signals
- Publisher's published example run (a real-time tracker app): ~20M tokens over 2 turns / 35 min on that run, 95–100% provider-cache hit rate, ~130 tok/s output. Agentic loops are cache-heavy wherever the provider honors prefix caching — verify per route on our model stack.
- Community confirmed: OpenRouter + Ollama + custom providers all work via provider config; community discussion proposes first-class self-hosted gateway (LiteLLM-class) provider support.

---

## 2. Current EdgeGDE SDLC — the gap a harness would fill

EdgeGDE competitive research (2026-06-27, DOC-RES-0001) scored our native coding capability **10/100** — the single biggest gap. Current chain:

```
Hermes (Director, LiteLLM :4000 → ornith-class/free-tier routes)
  → Droid (deterministic worktree orchestrator, NOT a text editor)
      → Coder (ornith:9b @ Ollama; OpenRouter free-tier fallback)  ← hand-rolled LLM call w/ full-file replacement
      → Aegis (LSP/typecheck/tests gates) → Hermes verifies
  → PR → CI (7 gates) → squash → auto-deploy (wrangler/CF Workers)
```

Current pain points (each a lesson learned the hard way):
1. **Coder is hand-rolled**: no true agent loop, no multi-file coordination, no planning/goal/todo tool, no context compaction, no retry/backoff (we built adapter.py out of necessity).
2. **Diff hallucination**: weak models fabricate diff hunks → forced "full-file replacement" (token-expensive; SWE-bench resolve ≈ 0% on some free models).
3. **Distributed audit trail**: mission reports per-executor; no event-stream replay primitive.
4. **Model routing is external** (LiteLLM) but the coder didn't know about it — cache, usage, and failover were approximate.
5. **Benchmarking is manual** — SWE-bench Lite baseline setup via external Pier/DeepSWE harness.
6. **Aider/Codex/Claude Code** are discrete fallbacks — each re-implements editor/plan/tool semantics.

---

## 3. Benefits of a generic harness as the coding engine

1. **Native agentic code** — closes the #1 competitive gap (10→target 70+) without building one: the loop, plan mode, todo tool, LSP gate, fs/bash tools ship with the harness. We stop hand-rolling a Coder.
2. **Sovereign traceability** — the append-only SessionEvent log IS our mission audit trail, with replay/fork. "Every run is traceable" maps directly to EdgeGDE's determinism + auditability charter (Aegis logs, FRS-001 replay).
3. **Plugin-shaped governance** — `tools/pre-execute` allow/deny/ask + ToolRestriction = EdgeGDE deny-by-default INSIDE the coder (same model AegisPolicyGate already took for canvas mutations).
4. **Headless = Droid-native** — `dsh --profile headless "task"` is a one-shot instrumented subprocess: Hermes keeps lifecycle ownership; Droid keeps provisioning worktrees; the harness replaces "call ornith via /api/chat" with a real agent and produces a durable session log.

The execution chain becomes:

```
Hermes (Director, unchanged)
  → Droid (provisions worktree, spawns headless harness, collects audit log)
      → harness session (fs/bash/lsp tools; policy gate; retry; cache-aware logging)
      → SessionEvent log → .hermes/missions/{mission}.report.json
  → Aegis (existing 7 gates, typecheck/tests) → Hermes (verify) → git → PR → CI → merge → deploy
```

5. **Model-side, provider-agnostic** — the pi-ai adapter covers Ollama (ornith:9b local, free), OpenRouter (free tiers first), LiteLLM gateway, any OpenAI-compatible endpoint. Our entire free-first/least-cost failover stack slots in as a route (config change, no code). Per-provider retryPolicy + replay-aware usage reporting = real token-level telemetry (Warren's requirement).
6. **Multi-agent without forking** — the subagent seam can call Codex or Claude Code as children; we keep one orchestrated path and pick the best tool per task without maintaining N executors.
7. **Benchmarks we own** — the harness's minimal 2-tool mode is a clean benchmark environment (publisher scores were produced exactly this way). SWE-bench baseline for the Coder becomes config, not a custom external stack.
8. **MIT license** — full commercial freedom; plugin ecosystem; no vendor lock (self-host with a local model or any gateway).

---

## 4. How our learnings transform into a unique "EdgeGDE Harness"

The unique part isn't the harness codebase — it's our EdgeGDE bundle on top. Every hard-won lesson maps to an extension point; this composition is generic (works with any compliant harness):

| EdgeGDE lesson (won with pain) | Harness transform |
|---|---|
| "Droid is NOT a text editor" | Harness owns editing; Droid spawns headless sessions and captures logs — Droid code stays governance-only |
| Full-file replacement (diff hallucination) | Harness fs/str_replace tools are deterministic, model-independent edits; no model-authored unified diffs |
| LSP = headless gate, not autocomplete | Harness ships `lsp/`; wire as pre-commit static gate plugin (type errors → self-correct before PR) |
| Aegis policy gate (3-role denial) | Port policy: harness policy plugin (tools pre-execute allow/deny/ask + ToolRestriction) enforcing Hermes's permissions for the coder |
| State precedes action; commits on read-back | SessionEvent log + tool/result diff meta → read-back verification is native: Hermes verifies against the log (turn/end, step, usage), not just the exit code |
| Audit trail → mission `.report.json` | Adapter: session log → `logs/missions/{mission}.report.json`; replay/fork = traceability |
| Determinism / repeatability | Log-based replay (same events, same projection); snapshot/fork for rehearsal |
| Free-first, least-cost routing, failover | LLM route → LiteLLM :4000 (ornith local first, OpenRouter free tiers, near-instant failover on our pre-check/cooldown patterns) |
| Measurement over intuition | Minimal mode = native benchmark engine; SWE-bench Dev split as the regression gate |
| Token efficiency (cache, budgets) | Provider prefix-cache leverage + session-log budgets; configurable caps per mission |
| Improvement loop (lesson → skill patch) | Hooks bridge: session log → detected pitfalls → auto skill patch |
| Kanban / HITL gates | Interaction seam: approval, ask-user inside the loop; Hermes keeps approver authority |

**The unique bundle (what we build, what the harness doesn't ship):**
- `@edgegde/h-llm` — LiteLLM provider route wired to :4000, honoring free-first order + fallback; no provider lock-in
- `@edgegde/h-policy` — deny-by-default tool gating (no shell/delete/network except whitelisted), Hermes/Droid scoped permissions
- `@edgegde/h-lsp-gate` — typecheck/LSP auto-run between execute and verify; self-correct loop on failure
- `@edgegde/h-audit` — SessionEvent → mission report adapter (JSON-Lines, existing schema)
- `@edgegde/h-worktree` — sandbox/fence binding to `EdgeGDE-worktrees/work-*`
- **`edgegde` profile** = bundle of the above + headless → launched by Droid as `harness --profile edgegde "task"`

This isn't "use someone's product" — it's **running a generic agent-harness kernel for EdgeGDE's own deterministic SDLC**, the coding equivalent of riding on React: we own the composition, not the kernel.

---

## 5. Risks / cost-benefit

| Risk | Severity | Mitigation |
|---|---|---|
| Developer preview, breaking changes | High | Pin+vendor a tagged commit (MIT allows); keep our surface = only our plugins; re-baseline weekly; no bleeding-edge adoption |
| Node-only runtime (Node ^22) | Low | Infra already Node/bun-compatible |
| Token cost on real builds (publisher example ≈ 20M tokens) | Medium | Cache leverage where honored; free-tier routes via LiteLLM; per-mission token budgets; measure vs current spend |
| Subagent SDKs (Claude Code/Codex) heavier payloads | Low | Optional bundles, not in default closure |
| New harness = new skill surface for team (Hermes + cron) | Low | Wrapper = one headless command; report parsing stays in Droid |
| Provider-cache behavior varies per route | Low | Log cache-hit metrics via token meter; route selection stays ours |

**Build cost estimate:** ~2–4 weeks to vendor + 5 EdgeGDE plugins + adopt into Phase 4 executor matrix — versus 4–6 weeks to hand-build a minimal native coding engine (June roadmap) for fewer capabilities.

---

## 6. Recommendation

**Adopt a generic agent harness as the coding engine — staged, Hermes as sole director.**

- **Phase A (proof, 1–2 days):** clone + vendor tagged commit; run headless mode against a REAL EdgeGDE task (e.g. a schema change) in a worktree; route models via LiteLLM :4000 (ornith local → OpenRouter free); capture session log; compare vs current Coder on: typecheck green, tests pass, time, tokens, audit completeness.
- **Phase B (integration, 1–2 weeks):** the 5 EdgeGDE plugins (policy, LSP gate, audit, worktree, LLM route); headless profile wired into Droid; keep the current 13-phase SDLC unchanged; run both modes side-by-side (A/B on 3–4 backlog features).
- **Phase C (production):** if A/B + benchmark wins hold, switch default Coder → harness; deprecate the hand-rolled full-file path; live SWE-bench Dev-split baseline; publish **EdgeGDE-Harness resolve rate**; retire Aider from the chain (unless mechanical fallback needed).

Sequence reason: the harness closes our #1 competitive gap while every governance/audit/instrumentation requirement becomes an extension point instead of a build. Model choice stays ours (local-first, free-tier, LiteLLM routing). Hermes's role as director/general-purpose framework is untouched — the harness is just another governed runtime underneath the same Hermes→Droid→Aegis boundary.

**Riskiest assumption to validate first:** one 60-minute mission in headless mode via the LiteLLM route to prove (a) headless stability on macOS, (b) session-log audit quality, (c) token cost profile vs the current ornith path.