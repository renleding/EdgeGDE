# Functional Requirements Specification (FRS): Agent Runtime Enhancements

**Document ID:** FRS-AGENT-RUNTIME-001  
**Version:** 1.1  
**Status:** Implemented  
**Author:** Hermes (Director)  
**Date:** 2026-07-06  
**Source:** Deep Agents (LangChain) architecture review

---

## 1. Objective

Adopt three targeted improvements from the Deep Agents agent harness to reduce token waste, improve agent autonomy, and enable dynamic capability loading in the EdgeGDE/Hermes agent runtime.

---

## 2. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-07-07 | Implemented: skill_discover, offload, recall tools committed and deployed |
| 1.0 | 2026-07-06 | Initial specification |

---

## 3. Current Baseline

### 3.1 Skill Loading (Hermes)

Skills are loaded at session start or via cron job `skills` parameter:

- `skill_view(name)` loads a skill's SKILL.md **on demand** when the agent explicitly calls it
- Cron jobs pre-load skills via the `skills` array
- No mechanism for the agent to **discover** which skill matches the current task mid-session
- No lazy-load trigger — skills are either pre-loaded (wasting context if unused) or the agent must know the name to call `skill_view`

**Gap:** The agent cannot inspect a task, determine "this requires knowledge I don't have," and autonomously discover + load the relevant skill without being told the name.

### 3.2 Context Management (Hermes)

Hermes uses automatic context compaction (per-turn summarisation of earlier turns). Large tool outputs are kept in the message stream.

- The `session_search` tool retrieves past transcripts
- The `memory` tool persists durable facts
- Large tool outputs (>50KB) are capped/truncated by the tooling
- No explicit **offload/replace-with-pointer** pattern for outputs that need preservation but not active reasoning

**Gap:** The agent must either keep large results in context (wasting tokens) or lose them entirely. There's no middle ground where a result is stored to disk and retrievable on demand via a short token.

### 3.3 Filesystem Backend (Hermes)

Hermes' file operations (`read_file`, `write_file`, `search_files`, `patch`) operate on a single local filesystem. The `terminal` tool runs shell commands locally.

- No abstraction for sandboxed/remote/ephemeral filesystems
- Worktree isolation is manual (git worktree + branch switch)
- CI execution is a separate environment with no shared filesystem interface

---

## 4. Requirements

### 4.1 FEATURE-01: Lazy Skill Loading

**Priority:** P1  
**Effort:** Medium  

**User Story:** The agent encounters a task (e.g., "deploy to Cloudflare Workers") and should be able to discover and load the relevant skill mid-session without being told the name.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | New tool: `skill_discover(query)` — searches skill descriptions for relevance and returns top matches with names | Must |
| F01-R02 | `skill_discover` returns skill name, description summary, and match score for each result | Must |
| F01-R03 | Agent calls `skill_view(name)` on the most relevant result to load full content | Must |
| F01-R04 | Match scoring is text-based (skill name + description FTS5 against query) — no LLM call for discovery | Must |
| F01-R05 | Results are capped at top 5 matches, sorted by relevance | Must |
| F01-R06 | Skill descriptions are indexed at Hermes startup (skills list already exists via `skills_list`) | Should |
| F01-R07 | `skill_discover` returns a clear "no matches" message when no skill is relevant, so the agent doesn't hallucinate | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F01-N01 | Discovery must be faster than loading each skill individually | < 1s |
| F01-N02 | Zero LLM calls during discovery — purely index-based | N/A |
| F01-N03 | Must not break existing skill loading behaviour | Backward compatible |

**Acceptance Criteria:**

```text
AC1: Agent in a session types a command → calls skill_discover("deploy cloudflare worker")
     → receives [name="cloudflare-workers-deployment-workflow", score=0.92, ...]
     → calls skill_view("cloudflare-workers-deployment-workflow")
     → skill content is loaded and agent uses it.

AC2: Agent calls skill_discover("quantum chromodynamics pizza recipe")
     → receives "No matching skills found for query."

AC3: Cron jobs with pre-loaded skills continue to work identically.
```

---

### 4.2 FEATURE-02: Context Offloading

**Priority:** P1  
**Effort:** Medium  

**User Story:** After running a command that produces a large result (e.g., test output, file listing, scan results), the agent should be able to store the result to disk and replace it in context with a short pointer, then recall it on demand without re-executing.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | New tool: `offload(key, content)` — stores a string or structured value to a local offload store and returns a short token `<offload:key>` | Must |
| F02-R02 | New tool: `recall(key)` — retrieves the stored value by key from the offload store | Must |
| F02-R03 | Offload store persists for the duration of the session (not cross-session) | Must |
| F02-R04 | Offload store is local filesystem under `~/.hermes/offload/` — no database dependency | Must |
| F02-R05 | `offload` replaces the output in context with `<offload:key> (X chars stored)` for the agent to reference | Should |
| F02-R06 | `recall` returns the full stored content | Must |
| F02-R07 | Tool errored or `key` not found → clear error message | Must |
| F02-R08 | Auto-cleanup on session end (all offload files removed) | Should |
| F02-R09 | Agent should be prompted (via system instruction) to offload outputs > ~2000 chars | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | Offload write must be fast | < 50ms |
| F02-N02 | Recall must be fast | < 50ms |
| F02-N03 | No size limit on stored content (capped by disk) | Max 100MB per session |
| F02-N04 | Must not interfere with memory tool (persistent) or session_search (transcript) | Independent |

**Acceptance Criteria:**

```text
AC1: Agent runs a long test → output is 8,000 chars
     → calls offload("test_log", output)
     → stores to ~/.hermes/offload/<session_id>/test_log
     → returns "<offload:test_log> (8000 chars stored)"
     → Agent continues with short pointer in context.

AC2: Agent later calls recall("test_log")
     → returns the full 8,000 char output.
     → Agent can reference specific parts of the result.

AC3: Agent calls recall("nonexistent_key")
     → returns "Error: No offloaded data found for key 'nonexistent_key'."

AC4: Session ends → ~/.hermes/offload/<session_id>/ is cleaned up.
```

---

### 4.3 FEATURE-03 (Future): Pluggable Sandbox Filesystem

**Priority:** P2 (Future)  
**Effort:** Large  

**Context from Deep Agents:** Deep Agents supports local, sandboxed, or remote filesystem backends through a single `read/write/edit/search` interface. This enables the same agent code to operate on different execution environments without modification.

**When this would be useful:**
- Running the same agent flow against a CI environment (ephemeral)
- Operating on a remote server filesystem
- Operating on a sandboxed environment (gVisor, Firecracker)
- Testing mutations in an ephemeral clone before applying to production

**Not specified further — deferred for future iteration.**

---

## 5. Architecture

### 5.1 FEATURE-01: Lazy Skill Loading

```
skill_discover(query)                    skill_view(name)
        │                                      │
        ▼                                      ▼
 ┌──────────────┐                     ┌──────────────┐
 │ Skill Index   │                     │ Skill Store   │
 │ (FTS5 over    │◄─────────────────── │ (~/.hermes/   │
 │  names+desc)  │                     │  skills/*/)   │
 └──────┬───────┘                     └──────────────┘
        │
        ▼
 ┌──────────────┐
 │ Top-5 results│
 │ [name,score, │
 │  summary]    │
 └──────────────┘
```

**Implementation notes:**
- Index built from existing `skills_list` output (name + description metadata)
- FTS5 query against a structured mapping — no LLM call
- `skill_discover` is a thin tool wrapper over the index query
- No changes to `skill_view` — it loads full content as before

### 5.2 FEATURE-02: Context Offloading

```
offload(key, content)                  recall(key)
        │                                      │
        ▼                                      ▼
 ┌──────────────┐                     ┌──────────────┐
 │ Write to     │                     │ Read from    │
 │ ~/.hermes/   │                     │ ~/.hermes/   │
 │ offload/     │                     │ offload/     │
 │ {session}/   │                     │ {session}/   │
 │ {key}        │                     │ {key}        │
 └──────────────┘                     └──────────────┘
        │                                      │
        ▼                                      ▼
 Return "<offload:key>              Return full content
 (X chars stored)"                  or error if not found
```

**Implementation notes:**
- Session ID from the runtime context
- Files stored as plain text/markdown in session-named directory
- Cleanup: cron or Hermes shutdown hook removes session directories
- No size limit but practical cap at 100MB total per session

---

## 6. Verification Gates

| ID | Check | Phase |
|----|-------|-------|
| V01 | `skill_discover("deploy")` returns relevant skills (≥1 result) | Integration test |
| V02 | `skill_discover("xyzzy_nonexistent")` returns empty/no-match | Integration test |
| V03 | Existing `skill_view` + cron skill pre-load continues working | Regression |
| V04 | `offload("x", "data")` → file created at correct path | Unit test |
| V05 | `recall("x")` → returns "data" | Unit test |
| V06 | `recall("missing")` → clear error, not empty string | Unit test |
| V07 | Offload directory cleaned on session end | Integration test |
| V08 | All existing tests pass (598/598) | CI gate |

---

## 7. Constraints & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `skill_discover` adds new tool overhead per turn | Low | Discovery is local FTS5, < 1s; agent only calls when it identifies a knowledge gap |
| `offload`/`recall` used excessively | Low | Agent prompts encourage offload only for outputs > ~2000 chars; session-level disk cap at 100MB |
| Skill description index stale (new skills not indexed until restart) | Medium | Index rebuilt lazily: first `skill_discover` call after a new skill installation re-indexes if mtime changed |
| Offload files consume disk on long-lived sessions | Low | 100MB cap per session; cleanup on session end; existing cron jobs have disk monitors |

---

## 8. Future Considerations

| Item | Trigger for Revisit |
|------|-------------------|
| FEATURE-03: Pluggable sandbox filesystem | When agent needs to run CI-pipeline commands against an ephemeral environment from within the same session |
| Cross-session offload store | When `offload` data needs to survive beyond a single session (e.g., daily scan accumulators) |
| Skill auto-recommendation | When the agent's system prompt could include "you have skill gaps, try skill_discover" as a learned behaviour rather than a hard-coded prompt instruction |
| Skill creation from agent conversation | When the agent should be able to create new skills from successful multi-step workflows without manual authoring |

---

## 9. References

- Deep Agents README — https://github.com/langchain-ai/deepagents
- Hermes Agent Skills — https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- Existing EdgeGDE FRS documents: `docs/FRS-aegis-policy-gate.md`, `docs/FRS-chat-reliability-overhaul.md`
