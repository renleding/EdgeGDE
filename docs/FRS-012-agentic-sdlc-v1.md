# Functional Requirements Specification (FRS): Agentic SDLC — Plan-Code-Validate at Scale

**Document ID:** FRS-012  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-11  
**Source:** Kun Chen (ex-Meta L8) agentic engineering workflow — YouTube: Peter Yang interview (88B6DimMD2g)  
**Related:** FRS-002 (agentic coding capability), FRS-011 (APA MITM proxy), AGENTS.md Tribe-0 SDLC rules  

---

## 1. Objective

Adopt Kun Chen's agentic engineering workflow into the EdgeGDE SDLC so that:

1. **Planning is the leverage point** — heavy investment in detailed, measurable specs before any code runs
2. **Code execution is agent-autonomous** — agents run Code→Validate loops without human in the loop
3. **Human role shifts to planning + escalation only** — Hermes authors specs/verification criteria; Droid + agents execute + self-validate; only failures or ambiguities reach Hermes
4. **Concurrency multiplies throughput** — multiple agents run in parallel per mission, not just per-agent
5. **Governance moves left** — checks run in Droid before mutation, not just in CI

---

## 2. Change Log

|| Version | Date | Changes |
|---------|------|---------|---------|
|| 1.0 | 2026-10-11 | Initial specification — Plan-Code-Validate, parallel agents, left-shifted governance |

---

## 3. Current Baseline

### 3.1 SDLC State Machine (AGENTS.md §2)

EdgeGDE currently uses a 5-phase state machine: **DISCOVERY → ALIGNMENT → GATE → EXECUTION → VERIFICATION**. Phases are human-gated; each transition requires explicit approval.

**Strength:** Correctness over speed. Every mutation is deliberate.  
**Weakness:** Human is the bottleneck. Every code write, every verify decision, every retry goes through Hermes.

### 3.2 Mission Manifest (AGENTS.md §5)

Missions declare objective, tasks, constraints, and Saga compensation. Tasks have `verification_criteria` — currently prose descriptions, not executable checks.

**Strength:** Deterministic, auditable, compensation-aware.  
**Weakness:** `verification_criteria` are not executable; Droid cannot self-validate; Hermes must verify every outcome.

### 3.3 Agent Fleet (repo-worktree-policy)

6 agents (agent-1..6), each in a separate worktree. Port registry governs binding. Typically sequential work — one agent per task.

**Strength:** Isolation, port safety, CI-only D1 migrations.  
**Weakness:** Underutilized concurrency. Multiple independent tasks in one mission run sequentially.

### 3.4 Governance (AGENTS.md §6, Aegis policy-catalog.yaml)

Governance checks run in CI (Gate 3) and via Aegis policy validation. Mutations require Droid delegation.

**Strength:** Non-bypassable policy layer.  
**Weakness:** Checks happen *after* code is written (CI) or at delegation time, not inline with the mutation. A bad mutation can be written before CI catches it.

---

## 4. Requirements

### 4.1 FEATURE-01: Plan Phase — Heavy, Measurable Specs

**Priority:** P1  
**Effort:** Medium (~1-2 days)  

**User Story:** As Hermes (Director), I author a detailed, measurable spec BEFORE any code runs. The spec is an executable artifact — not just prose, but verification criteria the agent can run itself.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | Every mission MUST include a `plan` artifact that is more than a task list — it MUST define the target state, acceptance criteria, and measurable verification conditions | Must |
| F01-R02 | `verification_criteria` in each task MUST be executable — either a script path, a test command, or a structured check that Droid can run without Hermes intervention | Must |
| F01-R03 | The plan phase MUST output a spec that can be rendered visually (HTML/Canvas) so the human can see the target before agents execute | Should |
| F01-R04 | Mission specs SHALL follow the OpenSpec format (proposal.md, design.md, specs/, tasks.md) when the change has architecture impact | Should |
| F01-R05 | A mission SHALL NOT enter EXECUTION phase until `verification_criteria` are defined for every mutating task | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F01-N01 | Planning investment is proportional to mission complexity; simple fixes may use lightweight specs | Complexity-scaled |
| F01-N02 | Spec rendering (Canvas/HTML) must not block execution | < 2s render |

**Acceptance Criteria:**

```text
AC1: A mission with 3 mutating tasks has executable verification_criteria for each.
AC2: An agent can run verification_criteria without Hermes intervention — result is pass/fail.
AC3: A complex mission (new feature) has a rendered spec visible before execution.
AC4: A mission with no verification_criteria cannot pass the GATE — Hermes rejects it.
```

---

### 4.2 FEATURE-02: Code Phase — Agent-Autonomous Execution

**Priority:** P1  
**Effort:** Medium (~1-2 days)  

**User Story:** As a mission, once the spec is approved, agents execute the code phase autonomously — writing, testing, and iteratively validating — without Hermes reviewing every diff.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | The Code phase SHALL be executed by Droid + delegated sub-agents, not by Hermes directly | Must |
| F02-R02 | Agents SHALL run a Code→Validate loop: write code → run verification_criteria → if fail, adjust → repeat, up to a defined iteration limit | Must |
| F02-R03 | The Code phase SHALL NOT require Hermes review of intermediate diffs — only the final outcome is verified | Must |
| F02-R04 | Agents SHALL report progress via the action ledger (FRS-007) — every step is attributable and auditable | Must |
| F02-R05 | If the iteration limit is reached without passing verification, the agent SHALL escalate to Hermes with the current state and last failure | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | Code→Validate loop iteration limit | Configurable per mission (default 5) |
| F02-N02 | Agent must log every iteration attempt to the action ledger | Every step |

**Acceptance Criteria:**

```text
AC1: A mission enters Code phase → Droid executes without Hermes line-by-line review.
AC2: An agent fails verification → adjusts → retries → passes within iteration limit.
AC3: An agent exhausts iterations → escalates to Hermes with state + last failure.
AC4: Every code step is journaled with agent_id + owner_attestation (FRS-007).
```

---

### 4.3 FEATURE-03: Validate Phase — Autonomous Self-Verification

**Priority:** P1  
**Effort:** Medium (~1 day)  

**User Story:** As an agent, I validate my own work against the spec's verification_criteria before reporting completion. Hermes only reviews when validation fails or is ambiguous.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F03-R01 | The Validate phase SHALL run `verification_criteria` for every completed task before reporting success | Must |
| F03-R02 | Validation results SHALL be deterministic — same spec + same code → same validation result | Must |
| F03-R03 | If validation passes for all tasks, the agent SHALL report success and Hermes SHALL trust the result (no re-verification unless something changed) | Should |
| F03-R04 | If validation fails, the agent SHALL report the specific failure with enough detail for Hermes to decide retry vs. reject | Must |
| F03-R05 | Validation SHALL include the governance checks that are currently in CI (Gate 3) — moved left into the Validate phase | Must |
| F03-R06 | The Validate phase SHALL produce a verification report that Hermes can review without re-running checks | Must |

**Acceptance Criteria:**

```text
AC1: All tasks validated → agent reports success; Hermes accepts without re-verify.
AC2: One task fails validation → agent reports specific failure; Hermes decides.
AC3: Governance checks (Gate 3) pass in Validate phase → no CI failure on merge.
AC4: Validation is deterministic — re-running gives same result.
```

---

### 4.4 FEATURE-04: Parallel Agent Concurrency

**Priority:** P2  
**Effort:** Medium (~1-2 days)  

**User Story:** As a mission, I can run multiple independent tasks in parallel across agents/worktrees, not sequentially, so throughput scales with concurrency not elapsed time.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F04-R01 | A mission MAY declare tasks as `parallel: true` when they have no `depends_on` relationship | Must |
| F04-R02 | Parallel tasks SHALL run in separate worktrees to avoid filesystem contention | Must |
| F04-R03 | The coordinator (agent-6 or designated Hermes) SHALL track parallel task status and aggregate results | Must |
| F04-R04 | Parallel tasks SHALL share the mission budget (FRS-007 FEATURE-02) — aggregate accounting, no double count | Must |
| F04-R05 | A parallel task failure SHALL trigger the manifest's Saga compensation policy for that task only (not the whole mission, unless policy says `compensate_all`) | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F04-N01 | Max parallel tasks per mission | Configurable (default 5) |
| F04-N02 | Worktree creation for parallel tasks is automated by the coordinator | < 30s per worktree |

**Acceptance Criteria:**

```text
AC1: A mission with 3 parallel tasks → all 3 run concurrently, not sequentially.
AC2: Parallel tasks in separate worktrees → no filesystem conflicts.
AC3: Mission budget is shared across parallel tasks — aggregate, not per-task.
AC4: One parallel task fails → Saga compensates that task; others may continue.
```

---

### 4.5 FEATURE-05: Left-Shifted Governance (Pre-Mutation Checks)

**Priority:** P1  
**Effort:** Small (~0.5 day)  

**User Story:** As an agent, I run governance checks BEFORE mutating files, not after. Bad mutations are caught at the point of execution, not in CI.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F05-R01 | Droid SHALL run the governance checks (currently Gate 3: `any` types, `console.log`, test fakes, etc.) BEFORE applying any mutation | Must |
| F05-R02 | A mutation that fails governance checks SHALL NOT be applied — Droid rejects it and reports the failure | Must |
| F05-R03 | Governance checks SHALL be the same checks that run in CI — no divergence between pre-mutation and CI checks | Must |
| F05-R04 | Governance check results SHALL be journaled (FRS-007) as part of the action ledger | Should |

**Acceptance Criteria:**

```text
AC1: A mission attempts a mutation with `any` types → Droid rejects before write.
AC2: The same check in CI would catch it → pre-mutation check catches it first.
AC3: Governance check pass → mutation applied; result journaled.
AC4: No governance check passes in CI that didn't pass pre-mutation.
```

---

### 4.6 FEATURE-06: Visual Spec Artifacts (HTML/Canvas)

**Priority:** P3  
**Effort:** Medium (~1 day)  

**User Story:** As a human reviewer, I can see the target state of a spec rendered visually — not just read markdown — before approving execution.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F06-R01 | Specs with UI/behavioral impact SHALL be renderable as an HTML artifact (Canvas-based or static HTML) | Should |
| F06-R02 | The rendered artifact SHALL show the target state: routes, pages, data flow, or component structure as applicable | Should |
| F06-R03 | The rendered spec SHALL be generated from the same source as the text spec — single source of truth, no drift | Must |

**Acceptance Criteria:**

```text
AC1: A feature spec with UI impact renders as HTML showing the target layout/flow.
AC2: The HTML artifact is generated from the spec source — updating the spec updates the HTML.
AC3: A non-UI spec (backend-only) may skip rendering — not required.
```

---

## 5. Out of Scope

- Replacing Hermes as Director — Hermes still authors specs, approves gates, handles escalations
- Replacing CI — CI still runs after merge; left-shifted checks complement, not replace
- Removing human from planning — planning remains human-led with agent assistance
- Multi-repo coordination — this spec applies to single-worktree/agent missions
- Budget guardrails (FRS-007) — referenced but not redefined here

---

## 6. Dependencies & Related Documents

|| Artifact | Relation |
|----------|----------|
|| FRS-002 (agentic coding capability) | Foundational — agent capability assumptions |
|| FRS-007 (action ledger + budget guardrails) | FEATURE-04 budget sharing depends on aggregate accounting |
|| FRS-011 (APA MITM proxy) | Independent — different capability |
|| AGENTS.md §2 (5-phase state machine) | Phase definitions this spec refines |
|| AGENTS.md §5 (Mission Manifest) | `verification_criteria` field extended here |
|| AGENTS.md §6 (Verification Rules) | Verify phase extended with autonomous validation |
|| repo-worktree-policy (skill) | Worktree creation for parallel tasks (F04-R02) |
|| Kun Chen tools: Lavish, Treehouse, No Mistakes | Inspiration only — not adopted directly |

---

## 7. Suggested Phasing

|| Phase | Scope | Gap closed |
|-------|-------|----------|
|| 1 | FEATURE-01 (executable verification_criteria) + FEATURE-05 (left-shifted governance) | Human bottleneck in verify + post-hoc governance |
|| 2 | FEATURE-02 (Code phase autonomy) + FEATURE-03 (Validate phase autonomy) | Human bottleneck in code review |
|| 3 | FEATURE-04 (parallel concurrency) | Throughput ceiling |
|| 4 | FEATURE-06 (visual spec artifacts) | Spec review quality |

---

## 8. Verification

- Every requirement SHALL have at least one scenario (Given/When/Then)
- CI gate: `openspec validate frs-012-agentic-sdlc` — fails if scenarios missing
- Acceptance: AC1–AC4 for each feature, verified by running actual missions
