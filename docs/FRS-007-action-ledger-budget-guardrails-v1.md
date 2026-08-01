# Functional Requirements Specification (FRS): Tamper-Evident Action Ledger & Agent Budget Guardrails

**Document ID:** FRS-007  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-08-01  \
**Source:** Buzz (Block) design review — lessons 1 & 2 (verifiable paper trail, agent hard-stop limits); video CHEMPZ87FLw

---

## 1. Objective

Adopt two design principles from Block's Buzz (open-source Nostr workplace platform) into the EdgeGDE/Hermes execution layer:

1. **Verifiable paper trail** — every agent action is attributable to a specific agent identity and the human/governance decision that authorized it, in a tamper-evident, hash-chained ledger. No Nostr, no relay, no keypairs required.
2. **Agent hard-stop limits** — every delegated mission and cron run carries a token/cost/tool-call budget with a deterministic hard stop, preventing the multi-agent token-blowup failure Buzz's own demo exhibited.

---

## 2. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-01 | Initial specification |

---

## 3. Current Baseline

### 3.1 Action Journal (State Engine)

`apps/state-engine/action_journal.py` appends JSON-Lines telemetry to `~/.hermes/logs/state-engine/actions.jsonl`. Each entry is a flat dict with a `_timestamp` added at write time.

- No identity field — the journal does not record *which agent* performed an action
- No attestation field — the journal does not record *which approval/governance decision* authorized an action
- No hash chaining — entries can be edited, reordered, or deleted with no detection
- Append-only by convention only; nothing verifies the file was not rewritten
- `verify_report.py` lists "Action Journal" as a check, but only existence/count — no integrity verification

**Gap:** The ledger proves *an action happened*, but not *who ran it, who authorized it, or that the record is intact*. This is the "cryptographic paper trail" property of Buzz, missing locally.

### 3.2 Mission/Delegation Execution (Hermes + Droid Wrapper)

Hermes delegation (`delegate_task`), cron jobs (`cronjob`), and the Droid execution wrapper support:

- Time-based limits only — `timeout` on `terminal`, `process` wait timeouts
- No token accounting, no cost accounting, no tool-call caps
- No pre-flight budget estimation or rejection
- No budget-aware interaction with the Saga compensation path

**Gap:** A runaway agent (or a multi-agent conversation, as Buzz demonstrated) accumulates cost until manually stopped. There is no deterministic, pre-declared limit.

---

## 4. Requirements

### 4.1 FEATURE-01: Tamper-Evident Action Ledger

**Priority:** P1  \
**Effort:** Small (~1 day)

**User Story:** As an auditor or as Hermes (Director) verifying a mission, I can prove which agent performed each action, which governance decision authorized it, and that no entry in the ledger has been altered, deleted, or reordered since it was written.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | Every ledger entry MUST include `agent_id` — the stable identity of the executing entity (droid ID, Hermes profile, cron job ID) as set by the execution wrapper, not from mission-supplied content | Must |
| F01-R02 | Every entry MUST include `owner_attestation` — a resolvable reference to the governance/approval record that authorized the action (e.g. mission manifest ID + task ID, Gate 3 check ID); `null` when the action was not governance-authorized | Must |
| F01-R03 | Every entry MUST include `prev_hash` — SHA-256 of the canonical serialization of the immediately preceding entry (hash chain) | Must |
| F01-R04 | Every entry MUST include `entry_hash` — SHA-256 of the canonical serialization of the entry's own content excluding `entry_hash` but including `prev_hash` | Must |
| F01-R05 | Canonical serialization MUST be deterministic (sorted keys, fixed separators, no locale/version drift) so hashes are reproducible across runs | Must |
| F01-R06 | The ledger MUST be append-only; rotation to a new file MUST chain the new file's first `prev_hash` to the old file's last `entry_hash` | Must |
| F01-R07 | Verification MUST recompute the chain and report: total entries, first invalid entry index, and the tamper location (altered payload, broken link, or gap) | Must |
| F01-R08 | A missing or mismatched `prev_hash` MUST be flagged as a chain break by verification | Must |
| F01-R09 | Legacy entries written before this feature (no hash fields) MUST be reported as `legacy_unverifiable`, never as tampered | Must |
| F01-R10 | The journaling layer MUST be the only writer; entry fields (`agent_id`, `owner_attestation`) MUST be injected by the authenticated runner context, and the journal MUST reject entries carrying a caller-supplied `agent_id` or `entry_hash` | Must |
| F01-R11 | All state-engine actions and Droid-executed operations MUST write through the ledger | Should |
| F01-R12 | `verify_report.py` MUST include a ledger integrity check as part of its standard report | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F01-N01 | Hash computation overhead per entry | < 1 ms |
| F01-N02 | Journal append must not block action execution | Non-blocking or sub-ms write |
| F01-N03 | Deterministic hashing across Python versions and platforms | sha256 + stable JSON |
| F01-N04 | Backward compatible — existing journal files remain readable | No migration required |

**Acceptance Criteria:**

```text
AC1: Run N actions → `verify_report.py` reports chain intact (0 breaks, N entries).
AC2: Manually alter one byte in a middle entry → verification flags the exact
     entry index and reason (payload mismatch).
AC3: Delete one entry → verification flags a gap at the deletion point.
AC4: Pre-existing legacy entries (no hashes) → reported legacy_unverifiable,
     not tampered; chain resumes at the first hashed entry.
AC5: Rotate the journal → verification follows the chain across both files.
AC6: An entry forged with caller-supplied agent_id/entry_hash → rejected at write.
```

---

### 4.2 FEATURE-02: Agent Budget Guardrails

**Priority:** P1  \
**Effort:** Small–Medium (~0.5–1 day)

**User Story:** As a mission author or as Hermes (Director), I can declare a budget (tokens, cost, tool calls, duration) on any delegation or cron run. When the budget is exhausted the run hard-stops deterministically, journals the reason, and honors the manifest's Saga compensation policy — so a runaway agent can never silently accumulate cost.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | A mission/run MAY declare a budget: `max_tokens`, `max_cost_usd`, `max_tool_calls`, `max_duration_seconds` | Must |
| F02-R02 | Default budgets MUST apply when none are declared, scaled by autonomy level (low/medium/high) and operation family | Must |
| F02-R03 | Budget enforcement MUST be a hard stop: at limit, the run is terminated, journaled with reason code `budget_exhausted`, and no further side-effecting operations execute | Must |
| F02-R04 | Pre-flight estimation MUST run before execution (estimated tokens/cost from declared caps and model) and MUST reject a run whose estimate exceeds a configurable ceiling unless explicitly approved | Must |
| F02-R05 | Budget overrides (raising a ceiling or exceeding an estimate) MUST require explicit human/governance approval — same gate class as Gate 3 | Must |
| F02-R06 | Real-time accounting MUST track tokens, tool calls, and elapsed time at step granularity via the execution wrapper | Must |
| F02-R07 | A budget stop MUST trigger the manifest's Saga path per its `partial_failure_policy` (`stop` leaves completed steps; `compensate_all` rolls back) | Must |
| F02-R08 | Each budget-limited run MUST journal `budget_used` vs `budget_limit` per dimension in the ledger (FEATURE-01 integration) | Must |
| F02-R09 | The execution report and verification report MUST surface budget usage and any `budget_exhausted` terminations | Must |
| F02-R10 | Accounting MUST be per-mission aggregate — parallel sub-tasks share one mission budget, no double counting | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | Accounting overhead on action execution | < 1% latency |
| F02-N02 | Enforcement granularity for tool-call budget | Per tool call, before side effect |
| F02-N03 | No false terminations for legitimate parallel operations | Aggregate accounting per mission |
| F02-N04 | Defaults must never be higher than a published safe ceiling | Ceiling documented in config |

**Acceptance Criteria:**

```text
AC1: Run with max_tokens=500 → terminates at/near the limit, journaled
     budget_exhausted, no further side effects.
AC2: Mission declaring a budget above the ceiling → rejected at pre-flight
     unless explicitly approved.
AC3: Multi-step mission with budget stop and partial_failure_policy=compensate_all
     → completed steps compensated via existing Saga path.
AC4: Verification report shows budget_used vs budget_limit per dimension per mission.
AC5: Run with no budget declared → defaults applied, reported in the execution report.
AC6: Two parallel sub-tasks in one mission → aggregate accounting, no double count,
     no false stop at the sum of per-task limits.
```

---

## 5. Out of Scope

- Nostr protocol, relays, or cryptographic keypairs — the ledger achieves tamper-evidence with SHA-256 chaining only
- Signed Git commits — GitHub commit signing already covers the code path
- Identity provisioning — `agent_id` uses existing droid/profile/cron identities; no new identity system
- Cost metering per provider API call at network level — accounting happens at the execution wrapper step level

---

## 6. Dependencies & Related Documents

| Artifact | Relation |
|----------|----------|
| `apps/state-engine/action_journal.py` | Feature-01 primary implementation target |
| `apps/state-engine/verify_report.py` | Feature-01 verification integration (F01-R12) |
| Droid execution wrapper (Hermes) | Feature-02 enforcement point (F02-R06) |
| Hermes `delegate_task` / `cronjob` | Feature-02 budget declaration surface (F02-R01) |
| AGENTS.md Mission Manifest + Saga contract | F02-R07 compensation semantics |
| SDD/IDD for this change | To be authored after FRS approval |

---

## 7. Suggested Phasing

| Phase | Scope |
|-------|-------|
| 1 | FEATURE-01 ledger chaining + integrity verification (F01-R01..R12) |
| 2 | FEATURE-02 budget declaration + defaults + hard stop (F02-R01..R05) |
| 3 | FEATURE-02 accounting + Saga integration + reporting (F02-R06..R10) |
