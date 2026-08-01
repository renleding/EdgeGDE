# Intent Driven Design (IDD): Tamper-Evident Action Ledger & Agent Budget Guardrails

**Document ID:** IDD-007  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-08-01  \
**FRS Reference:** [FRS-007](./FRS-007-action-ledger-budget-guardrails-v1.md)  \
**SDD Reference:** [SDD-007](./SDD-007-action-ledger-budget-guardrails-v1.md)

---

## 1. Purpose

IDD defines the *intent* behind each interface in SDD-007 — what each component is designed to achieve, the contracts it fulfills, and the invariants it maintains. This is the contract layer: implementers satisfy these intents; consumers rely on them.

---

## 2. Interface Contracts

### 2.1 `ActionJournal.log(entry: dict) -> str` (ledger entry hash)

**Intent:** Record every executed action as a tamper-evident, attributable ledger entry. The journal exists so that EdgeGDE can *prove* what happened — which agent ran which action, under which authorization, with integrity intact — not merely store what happened.

**Contract:**
- Accepts a plain action payload. MUST NOT accept or honor caller-supplied `agent_id`, `owner_attestation`, `prev_hash`, or `entry_hash` (F01-R10)
- Injects `agent_id` (from authenticated runner context) and `owner_attestation` (from the authorization record, `null` if ungoverned)
- Computes `prev_hash` from the current chain head and `entry_hash` over canonical content
- Appends atomically as a JSON line; updates chain head
- Returns the computed `entry_hash` (usable as a receipt/pointer)
- On write failure: logs to stderr, sets `journal_degraded`, never blocks or raises into the caller

**Invariants maintained:** I1, I2, I3, I5 (SDD-007)

---

### 2.2 `ActionJournal.rotate()` -> None

**Intent:** Bound ledger file size while preserving a continuous, verifiable chain. Rotation must never create a verification gap.

**Contract:**
- Closes current file; first entry of the new file carries `prev_hash` = last `entry_hash` of the old file
- Old file is never modified after rotation
- Chain head cache survives rotation (and restart, by re-reading the current file's tail)

**Invariants maintained:** I4

---

### 2.3 `LedgerVerifier.verify(paths: list[str]) -> LedgerReport`

**Intent:** Answer the auditor's question deterministically: *is this ledger intact, and if not, exactly where and how was it violated?* The intent is attribution-grade assurance, not "the file exists" (which is all `verify_report.py` does today).

**Contract:**
- Walks ledger files in order; recomputes every hash; cross-checks `prev_hash` links
- Classifies legacy entries (no `entry_hash`) as `legacy_unverifiable` — never as tampered (F01-R09)
- Returns structured report: `total_entries`, `verified`, `legacy_unverifiable`, `first_invalid_index`, `failure_reason`
- Must run without network access or external services (pure local computation)

**Invariants maintained:** I2, I3

---

### 2.4 `BudgetController.preflight(mission) -> PreflightResult`

**Intent:** Prevent over-budget missions from *starting*. The intent is a cheap, deterministic rejection gate before any tokens are spent — the same governance posture as Gate 3, applied to cost.

**Contract:**
- Resolves declared budget or applies defaults by `autonomy_level` + operation family
- Estimates tokens/cost from declared caps + model; compares against ceiling
- Returns `approved` | `rejected(over_ceiling)` | `approved_with_override(governance_ref)`
- Overrides require a resolvable governance approval reference (F02-R05); no silent escalation

**Invariants maintained:** I7 (enforced upstream of execution)

---

### 2.5 `BudgetAccounting.record(usage_delta) -> None` / `BudgetAccounting.state() -> BudgetState`

**Intent:** Keep a live, per-mission aggregate of spend so the hard stop fires on reality, not on estimation. The intent of aggregation is that parallel sub-tasks share one mission budget — a mission is the accounting unit, not a sub-process (F02-R10).

**Contract:**
- Counters: tokens, cost (USD), tool calls, elapsed seconds
- `state()` returns per-dimension `{used, limit, exhausted: bool}` and never blocks
- On `exhausted`: BudgetController is notified before the next side-effecting operation (I7)

**Invariants maintained:** I6, I7

---

### 2.6 `BudgetController.hard_stop(mission, reason) -> StopResult`

**Intent:** Terminate a runaway run deterministically and leave an auditable record. The intent is that a budget stop is a *first-class event* — journaled, compensated per policy, and visible in reports — not a silent kill.

**Contract:**
- Terminates the run; guarantees no further side-effecting operations
- Journals `reason_code="budget_exhausted"` + `budget_used`/`budget_limit` per dimension (F02-R08)
- Consults manifest Saga `partial_failure_policy`: `stop` leaves completed steps; `compensate_all` rolls back via existing compensation path (F02-R07)
- Returns structured result for the execution report

**Invariants maintained:** I7, I8

---

### 2.7 `verify_report.py` — Action Journal check (modified)

**Intent:** Every standard verification run answers "is the ledger intact?" automatically. Verification must never silently pass a tampered ledger.

**Contract:**
- Embeds `LedgerVerifier` output as the "Action Journal" section (F01-R12)
- A chain break or mismatch raises the check to FAIL with the exact first-invalid index and reason
- `legacy_unverifiable` entries do not fail the check (documented classification)

**Invariants maintained:** I2

---

## 3. Interface Intent Summary

| Interface | Designed to achieve | Must never do |
|-----------|--------------------|---------------|
| `ActionJournal.log` | attributable, tamper-evident action record | trust caller identity; block execution; silently drop entries |
| `ActionJournal.rotate` | bounded file size, continuous chain | break the chain across files |
| `LedgerVerifier.verify` | deterministic integrity verdict | require network; misclassify legacy as tampered |
| `BudgetController.preflight` | reject over-budget missions before spend | allow silent over-ceiling start |
| `BudgetAccounting.*` | live aggregate spend truth | per-sub-process double counting |
| `BudgetController.hard_stop` | deterministic, journaled termination | silent kill; skip Saga policy |
| `verify_report.py` check | automatic ledger integrity in every verify | pass a tampered chain |

---

## 4. Invariants Maintained Across Interfaces

Cross-cutting invariants from SDD-007 §6 that no single interface may violate:

- **I2 (chain integrity):** enforced by writer (2.1) and checked by verifier (2.3, 2.7)
- **I5 (identity injection):** enforced solely by 2.1 — the only trust boundary for identity
- **I7 (stop before side effect):** enforced by 2.5→2.6 handoff; 2.4 prevents starting over-budget
- **I8 (journal + saga on stop):** enforced by 2.6 alone

---

## 5. Design Intent Notes

1. **Why hash-chain instead of signatures:** EdgeGDE's audit value comes from deterministic local verification, not cryptographic identity. SHA-256 chaining gives tamper-evidence (any alteration breaks the chain) without key management, relays, or revocation — the "paper trail" property of Buzz minus its crypto infrastructure.
2. **Why injection over trust:** `agent_id`/`owner_attestation` come from the authenticated runner context because that context is the only place where identity cannot be forged by mission content. A mission that names its own agent identity would defeat the ledger's purpose.
3. **Why aggregate budgeting:** Buzz's token-blowup failure came from agents messaging each other past any single agent's limit. Per-mission aggregation means the *whole conversation* is bounded, not each participant — this is the actual failure mode we're preventing.
4. **Why hard stop before side effect:** verification-first philosophy (state changed = success) requires that a budget stop cannot produce a *half* side effect. The stop decision precedes the next operation, so the ledger always reflects a consistent boundary.
