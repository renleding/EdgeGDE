# DeepSeek Harness (dsh) as EdgeGDE Coding Engine — Feasibility Research

**Date:** 2026-08-21
**Author:** Hermes (Director)
**Card:** DOC-RES-034
**Question:** Should DeepSeek Harness become the coding engine for EdgeGDE, with Hermes remaining the director and general-purpose agent framework?

---

## 1. What DeepSeek Harness Is

- **`dsh`** = open-source (MIT) agent harness from DeepSeek AI, released 2026-08-13 alongside V4 Pro. 176k★ / 19k forks, ~13k commits, active daily pushes.
- Built on **Cordis** (plugin meta-framework, "A Programming Paradigm for Spatiotemporal Composability"). **Everything is a plugin**: models, tools, skills, sessions, sandboxes, filesystems, loops, scheduling, UI. No privileged core to patch — extension means mounting a plugin beside the others.
- **Agent = Model + Harness.** dsh is DeepSeek's answer to Claude Code as an open, buildable runtime.
- **Every run is traceable**: append-only `SessionEvent` log (turn/step/tool events, system prompts, reasoning, tool calls/results, context injections — "model-visible ⟺ logged" is a runtime invariant). Trajectory view, resume, fork, search, replay all derive from that one stream.

### Capability surface relevant to us (verified from source)

| Package | What it gives us |
|---|---|
| `core/session` | Append-only typed event log = **built-in audit trail** (source of truth; LLM history is derived, replayable) |
| `core/tools` | Typed tool registry + **pre-execute allow/deny/ask waterfall**, post-execute inspect/replace, per-scope `ToolRestriction` allow/deny filters |
| `llm/` | **LLM capability seam**: `llm-deepseek` (official DS API) + `llm-pi-ai` (multi-provider: OpenAI, Anthropic, DeepSeek, OpenRouter, Ollama, **any OpenAI-compatible gateway** incl. LiteLLM); provider scoped retryPolicy; replay-aware token meter; thinking/reasoning-effort mapping |
| `subagent/` | Execution seam: in-process spawn/fork, out-of-process over ACP, **real Codex child**, **real Claude Code child** (official SDK) — optional bundles |
| `acp/` | Automation-only Agent Client Protocol server (JSON-RPC) = deterministic programmatic control channel for Hermes |
| `sdk/` | JSON-RPC protocol, server, TypeScript client; **Python SDK** for benchmarks |
| `bundle/headless` | One-shot no-server runner: `dsh --profile headless "task"` → prints result, exit 0/1. Perfect Droid-style automation |
| `fs/ shell/ terminal/` | Filesystem policy, bash/pwsh, persistent terminals — sandboxable |
| `lsp/` | **Language-server capability**: headless LSP as a validation gate (exactly our stance since 2026-06-27) |
| `cpp` `pending` `guard/` | loop-hygiene: repeat-tool reminders, tool-call timeout policy |
| `hook/` | Claude Code / Codex shell-hook bridge |
| `skill/` | Skill provider registry + catalog/loader tool |
| `workflow/` | D-Swarm workflow capability + worker-thread provider |
| `preset/` | Per-session agent composition (tools + persona as rows) |
| `self-modification/` | Agent can inspect/mount its own plugins (Creator mode) |
| `interaction/` | Approval, permission presets, commands, ask-user — HITL seams |
| `compaction/`, `context/` | Context compaction + request-context plugins (KV-cache friendly) |
| `e2b/` | Sandbox + FS/subprocess adapters (E2B POC) |

### Known real-world behavior signals
- Real-world ISS-tracker build: ~20M tokens over 2 turns / 35 min, 95–100% cache-hit rate, ~130 tok/s output. Token-hungry but cache-efficient; Flash > Pro for cost-to-output on coding.
- Community confirmed: OpenRouter + Ollama + custom providers all work via the UI/provider system; dsh's plugin system already integrated LiteLLM-class gateways as routes (GitHub Discussion #2529 explicitly proposes first-class self-hosted gateway providers).

---

## 2. Current EdgeGDE SDLC — the gap dsh would fill

EdgeGDE competitive research (2026-06-27, DOC-RES-0001) scored our native coding capability **10/100** — the single biggest gap. Current chain:

```
Hermes (controller/Director, LiteLLM→t2-orchestrator)
  → Droid (deterministic worktree orchestrator, NOT a text editor)
      → Coder (ornith:9b @ Ollama; DeepSeek V4 Flash fallback)  ← hand-rolled LLM call w/ full-file replacement
      → Aegis (LSP/typecheck/tests gates) → Hermes verifies
  → PR → CI (7 gates) → squash → auto-deploy (wrangler/CF Workers)
```

Current pain points (each a lesson learned the hard way):
1. **Coder is hand-rolled**: no true agent loop, no multi-file coordination, no planning/goal/todo tool, no context compaction, no retry/backoff (we built adapter.py OUT of necessity).
2. **Diff hallucination**: weak models fabricate diff hunks → forced "full-file replacement" (token-expensive, SWE-bench resolve ≈ 0% on some free models).
3. **Distributed audit trail**: missions report per-executor; no event-stream replay primitive.
4. **Model routing is external** (LiteLLM) but the harness didn't know about it — cache, usage, and failover were approximate.
5. **Benchmarking is manual** — SWE-bench Lite baseline setup via external DeepSWE/Pier harness.
6. **Aider/Codex/Claude Code** are discrete fallbacks — each re-implements editor/plan/tool semantics.

---

## 3. Benefits of dsh as the coding engine vs the current SDLC

1. **Native agentic code** — closes the #1 competitive gap (10→target 70+) without building Droid: dsh ships the loop, plan-mode, todo tool, LSP gate, terminal+fs tools, self-correction hooks. We stop hand-rolling a Coder; we get a production one.
2. **Sovereign traceability** — the append-only SessionEvent log IS our mission audit trail, with replay/fork. "Every run is traceable" maps directly to EdgeGDE's determinism + audatibility charter (Aegis logs, FRS-001 replay).
3. **Plugin-shaped governance** — with `tools/pre-execute` allow/deny/ask + ToolRestriction, we can enforce EdgeGDE's deny-by-default policy INSIDE the sandbox (same model our AegisPolicyGate already took for canvas mutations — now applies to the coding engine's own tool calls).
4. **Headless = Droid-native** — `dsh --profile headless "task"` is a one-shot instrumented subprocess: Hermes keeps life cycle ownership (whose truth), Droid keeps provisioning worktrees — dsh simply replaces "call ornith via /api/chat" with a real agent, and produces a durable session log.

Aa the execution chain becomes:

```
Hermes (director, unchanged)
  → Droid (provisions worktree, spawns headless dsh, collects audit log)
      → dsh (session log; fs/bash/lsp tools; policy gate; retry; cache-aware)
      → SessionEvent log → .hermes/missions/{mission}.report.json
  → Aegis (existing 7 gates, typecheck/tests) → Hermes (verify) → git → PR → CI → merge → deploy
```

5. **Model-side** — pi-ai adapter covers: DeepSeek official (flash + pro), OpenRouter, Ollama (locally-hosted ornith!), LiteLLM gateways, any OpenAI-compatible endpoint. Our entire free-first/least-cost failover stack can slot in as a route (config change, no code). KV-cache reuse + usage reporting that the harness log materializes — real token-level telemetry (Warren's requirement).
6. **Multi-agent without forking** — dsh calls Claude Code or Codex as sub-harnesses over its subagent seam. We keep a single orchestrated path (EDIT) allowing best-tool-for-task without maintaining N executors ourselves.
7. **Benchmarks we can own** — dsh minimal mode is DeepSeek's own benchmark harness (CodeAgent scores published in "minimal mode"). SWE-bench baseline for the Coder becomes a config + cookie vs a custom pier/DeepSWE stack.
8. **MIT license** — full commercial freedom; plugin ecosystem; no vendor lock (can self-host with a local model or any gateway).

---

## 3. How every learning transforms into a unique "EdgeGDE Harness" code

Our existing learnings map one-to-one onto dsh extension points — this composition isn't a generic copy of DeepSeek's web app; it's EdgeGDE's SDLC kernel made alive:

| EdgeGDE lesson (won with pain) | dsh transform |
|---|---|
| "Droid is NOT a text editor" | dsh owns editing; Droid spawns headless sessions and captures logs — Droid code stays governance-only |
| Full-file replacement (diff hallucination) | dsh fs/str_replace tools are deterministic, model-independent edits; deliver deltas, not model-authored unified diffs |
| LSP = headless gate, not autocomplete | dsh ships `lsp/` capability; wire as pre-commit static gate plugin (type→error→self-correct before PR) |
| Aegis policy gate (3-role denial) | Port policy: a dsh policy plugin (tools pre-execute allow/deny/ask + ToolRestriction) enforcing Hermes's permissions for the coder |
| State precedes action; commits on read-back | SessionEvent log + tool/result diff meta → read-back verification is native: Hermes verifies against the log (turn/end, step, usage) not just the exit code |
| Audit trail -> mission .report.json | Audible adapter: session log → `logs/missions/{mission}.report.json`; replay/fork = traceability |
| Determinism / repeatability | Log-based replay (same events, same projection); snapshot/fork for continuous rehearsal |
| Free-first, least-cost routing, failover (your LiteLLM rule) | llm-pi-ai route = LiteLLM/loud; providerPersisted retry policy on agent/request-error (adds to our precheck/cooldown patterns) |
| Measurement over intuition (SWE-bench baseline) | Minimal mode is native benchmark engine; DeepSeek API budget as another cable; ornith/9B as a local route |
| Token efficiency (cache, limits) | 100% cache-hit astrology practice + session log raw chunks ✓; cRanges+ budgets configurable |
| Improvement loop (lesson-patch → skill) | Hooks bridge: Claude Code/Codex hook protocol plugins; session-log → detected pitfalls → auto skill patch |
| Kanban task / HITL gates | interaction seam: approval, ask-user within the agent loop; keep Hermes/model-selection as the approver not the tool |

**The unique bundle (what we would build on dsh, not dsh-provided):**
- `@edgegde/dsh-llm` — LiteLLM provider route (OpenAI-compatible) wired to our existing :4000 gateway, honoring free-first order + fallback.
- `@edgegde/dsh-edgegde-policy` — deny-by-default tool gating (no shell/delete/network except whitelisted), Hermes / Droid scoped permissions.
- `@edgegde/dsh-lsp-gate` — typecheck/LSP auto-run between execute and verify; self-correct loop when failing.
- `@edgegde/dsh-audit` — SessionEvent → mission report adapter (JSON-Lines, existing schema).
- `@edgegde/dsh-worktree` — sandbox profiling/fencing (worktree under `EdgeGDE-worktrees/work-*`).
- **`edgegde` dsh profile** (bundle of the above + headless) — `dsh --profile edgegde "task"` launched by Droid.

That is not "use DeepSeek's product"; that is **Running the DeepSeek Harness as a kernel for EdgeGDE's own deterministic SDLC** — the coding equivalent of riding on top of React.

---

## 4. Risks / Cost-benefit

| Risk | Severity | Mitigation |
|---|---|---|
| Developer preview, breaking changes (explicit warning) | High | Pin+vendor a tagged fork (MIT allowed); keep bundle layer so surface = only our plugins; upstream-track weekly; do not adopt on bleeding edge |
| Node-only runtime (Node ^22) | Low | Our infra already Node/bun; electron-vite fine |
| Token cost (2M tokens/real build noted) | Medium | Cache-leverage; flash-first default; LiteLLM free routes; token-budget & refusal policy; verify against existing spend |
| Subagent SDKs (Claude Code/Codex) heavier | Low | Optional bundles not in default closure; use only when deliberately delegating |
| New harness = new skill surface for the team (Hermes + cron) | Low | Wrapper = one headless command + report parsing stays in Droid |
| 100% test coverage/quality bar of repo (their AGENTS.md enforces per-file 100% coverage on own packages — we only vendor, not contribute) | Low | Vendor without assignment; contributions optional |
| Session log visibility (no secrets by default: credentials via apiKeyEnv — sensible) | Low | Credential seam, avoid `.env` in session |

**Build cost estimate:** Per our experience, ~2–4 weeks to vendor + 5 EdgeGDE plugins + adopt into Phase 4 executor matrix (compared to 4–6 weeks to build a minimal native coding engine per the June roadmap — for fewer fruits).

---

## 5. Recommendation

**Dovetailing: YES, adopt dsh as the coding engine — but staged, and run by Hermes as the sole dir. Director. 3-Phase transition:**

- **Phase A (proof, ~1–2 days):** clone + vendor tagged commit; run official headless mode against a REAL EdgeGDE skill task (e.g. a schema change) in a worktree; log routing to LiteLLM; capture session log; compare vs Coder abc 9b / deepseek-v4-flash on: typecheck green, tests pass, time, tokens, audit completeness.
- **Phase B (integration, 1–2 weeks):** edgee plugin set (policy, LSP gate, audit adapter, worktree binding); headless profile wired into Droid; keep current 13-phase SDLC unchanged. Ship both modes (Coder fallback remains) — A/B on 3-4 backlog features.
- **Phase C (production):** if A/B + benchmark wins beyond, switch default Coder→dsh; deprecate ornith full-file path; live SWE-bench (Dev split) baseline; publish **EdgeGDE-Harness resolve rate**; retire Aider from the chain (unless needed for mechanical fallback).

Sequence/reason: The harness closes our #1 competitive gap while every governance/audit/instrumentation requirement becomes an extension point instead of a build. Model choice stays ours (LiteLLM / free-first). Hermes's role as director/general-purpose framework is not touched: we add one more governed runtime underneath the same Hermes→Droid→Aegis boundary.

**Riskiest assumption to validate first:** do a 60-pp-mission in headless mode with LiteLLM route (DeepSeek V4 Flash/Pro local) to prove (a) headless stability on macOS, (b) session log audit quality, (c) token cost profile vs current path.