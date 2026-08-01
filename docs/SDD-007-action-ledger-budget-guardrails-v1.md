# System Design Document (SDD): Tamper-Evident Action Ledger & Agent Budget Guardrails

**Document ID:** SDD-007  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-08-01  \
**FRS Reference:** [FRS-007](./FRS-007-action-ledger-budget-guardrails-v1.md)

---

## 1. Scope

Internal architecture for FRS-007: how the hash-chained Action Ledger (FEATURE-01) and the budget guardrail subsystem (FEATURE-02) are built, where they live, and how data flows through them. Complementary to EG-SEC-0002 (mission-report chaining + AuditLedger_DO) — FRS-007 targets the per-action journal and the execution wrapper; EG-SEC-0002 targets mission reports and the Cloudflare ledger.

---

## 2. Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────┐
│                       Execution Layer                            │
│                                                                  │
│  Hermes (delegate_task / cronjob)          Droid wrapper         │
│        │  budget declaration                    │                │
│        ▼                                        ▼                │
│  ┌─────────────────────────┐        ┌──────────────────────┐     │
│  │  BudgetController       │◄──────►│  BudgetAccounting    │     │
│  │  (preflight + hard stop)│        │  (per-mission)       │     │
│  └────────────┬────────────┘        └──────────┬───────────┘     │
│               │ authorize / reject            │ usage            │
└───────────────┼────────────────────────────────┼─────────────────┘
                │                                │
┌───────────────┼────────────────────────────────┼─────────────────┐
│               │          Telemetry Layer       │                 │
│               ▼                                ▼                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  ActionJournal (ledger writer — single writer, hash chain)│   │
│  │  actions.jsonl + actions.rotate-*.jsonl                    │   │
│  └───────────────────────────┬───────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  LedgerVerifier (chain recompute + integrity report)      │   │
│  │  — wired into verify_report.py                            │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Owner |
|-----------|----------------|-------|
| `BudgetController` | Preflight estimation, ceiling checks, override approval gate, hard-stop trigger | Hermes wrapper |
| `BudgetAccounting` | Per-mission aggregate counters (tokens, cost, tool calls, elapsed); feeds usage into ledger entries | Hermes wrapper + Droid wrapper |
| `ActionJournal` | Sole writer of the ledger; canonical serialization; hash-chain computation; caller-field rejection; rotation | State Engine |
| `LedgerVerifier` | Chain recompute, tamper detection, legacy-entry classification, report output | State Engine (`verify_report.py`) |

---

## 3. Data Flow

### 3.1 FEATURE-01 — Ledger write path

```text
1. Execution wrapper completes an action
2. Wrapper calls journal.log(entry) with plain action fields ONLY
   (agent_id, owner_attestation are injected by ActionJournal, not accepted from caller)
3. ActionJournal:
   a. loads last entry's entry_hash from chain head cache (in-memory + tail of file)
   b. composes full entry: action fields + agent_id + owner_attestation + prev_hash
   c. canonical_serialize(entry) → entry_hash
   d. append JSON line; update chain head cache
4. Rotation (size or explicit): new file's first prev_hash = old file's last entry_hash;
   chain head persists across files
```

### 3.2 FEATURE-01 — Verify path

```text
1. LedgerVerifier reads all ledger files in order
2. For each entry:
   a. legacy? (no entry_hash) → classify legacy_unverifiable, skip chaining
   b. recompute canonical(entry minus entry_hash) → compare to stored entry_hash
   c. compare entry.prev_hash to previous entry.entry_hash
3. Report: total_entries, verified, legacy_unverifiable, first_invalid_index, failure_reason
4. verify_report.py embeds this as the "Action Journal" check
```

### 3.3 FEATURE-02 — Budget lifecycle

```text
1. Mission/run declared with budget {max_tokens, max_cost_usd, max_tool_calls, max_duration_seconds}
   — or defaults applied from autonomy_level + operation family
2. Preflight: BudgetController estimates cost/tokens from declared caps + model
   → estimate > ceiling? → reject unless governance-approved override
3. Execution: BudgetAccounting increments per tool call / step (aggregate per mission)
4. Any counter ≥ limit → BudgetController hard stop:
   a. terminate run (no further side-effecting operations)
   b. journal entry with reason_code="budget_exhausted" + budget_used/budget_limit
   c. invoke manifest Saga path per partial_failure_policy (stop | compensate_all)
5. Execution + verification reports include budget_used vs budget_limit per dimension
```

---

## 4. Data Structures

### 4.1 Ledger entry (post-injection, canonical form)

```json
{
  "ts": "2026-08-01T00:00:00Z",
  "agent_id": "droid:mission-42:step-3",
  "owner_attestation": "gov:gate3:check-881",
  "action": "write_text",
  "target": "apps/edge-runtime/src/x.ts",
  "result": "ok",
  "prev_hash": "sha256:...",
  "entry_hash": "sha256:..."
}
```

- `entry_hash` = sha256( canonical( entry without `entry_hash` ) )
- `canonical_serialize` = JSON dump with `sort_keys=True`, `separators=(",",":")`, `ensure_ascii=False`, fixed UTC ISO-8601 timestamps
- Caller-supplied `agent_id` / `entry_hash` / `prev_hash` → rejected (F01-R10)

### 4.2 Budget declaration (mission manifest / cron)

```json
{
  "budget": {
    "max_tokens": 5000,
    "max_cost_usd": 0.5,
    "max_tool_calls": 200,
    "max_duration_seconds": 3600
  }
}
```

Defaults table (config-driven, `budget_defaults.yaml`):

| Autonomy | max_tokens | max_cost_usd | max_tool_calls | max_duration_s |
|----------|-----------|--------------|----------------|----------------|
| low      | 2,000     | 0.10         | 50             | 900            |
| medium   | 8,000     | 0.50         | 200            | 3600           |
| high     | 25,000    | 2.00         | 1000           | 14400          |

Ceiling (config): `budget.ceiling.max_cost_usd = 10.0` — anything above requires governance override (F02-R05).

---

## 5. File Structure

```text
apps/state-engine/
  action_journal.py          # MODIFIED: hashing, identity injection, rotation, caller rejection
  ledger_verify.py           # NEW: chain recompute + tamper report
  verify_report.py           # MODIFIED: embeds ledger integrity check (F01-R12)
  budget_defaults.yaml       # NEW: default budget table + ceiling
~/.hermes/ (Hermes side)
  wrappers/budget_controller.py   # NEW: preflight + hard stop + override gate
  wrappers/budget_accounting.py   # NEW: per-mission aggregate counters
  logs/state-engine/actions.jsonl # ledger (append-only, rotated with chaining)
```

---

## 6. Invariants

| # | Invariant |
|---|-----------|
| I1 | The ledger has exactly one writer (`ActionJournal`); no other process appends |
| I2 | Every post-migration entry has a valid `entry_hash`; `prev_hash` of entry N == `entry_hash` of entry N-1 |
| I3 | Canonical serialization is deterministic across runs, Python versions, platforms |
| I4 | No in-place edits, deletes, or reorders — rotation chains across files |
| I5 | `agent_id` / `owner_attestation` are never taken from caller input |
| I6 | Budget accounting is per-mission aggregate (parallel sub-tasks share one budget) |
| I7 | A hard stop occurs BEFORE any further side-effecting operation |
| I8 | Budget stop always journals `budget_exhausted` and always consults the Saga path |

---

## 7. Failure Modes

| Failure | Detection | Handling |
|---------|-----------|----------|
| Journal disk full / write error | journal.log() exception | Log to stderr, do NOT block action; mark in-memory `journal_degraded`, surface in next verify report |
| Chain head cache lost (restart) | ActionJournal init | Re-read last line of current file to rebuild chain head |
| Two processes race to append | Single-writer ownership + O_APPEND | Write is atomic line append; verification catches any interleaving corruption |
| Budget accounting drift (under-count) | verify compares journaled usage vs execution report | Flag `accounting_mismatch` in verification report |
| Preflight false-negative (estimate under real cost) | Hard stop still enforced at runtime | Terminate + journal; no silent overrun |

---

## 8. Verification Strategy

1. Unit: canonical serialization stability (same input → same hash across invocations)
2. Unit: chain link correctness (insert/delete/alter → exact failure index)
3. Unit: legacy classification (pre-hash entries → legacy_unverifiable)
4. Unit: rotation continuity (chain spans file boundary)
5. Unit: budget hard stop at each dimension (tokens, cost, tool calls, duration)
6. Unit: saga interaction (stop vs compensate_all on budget exhaustion)
7. Integration: `verify_report.py` end-to-end with a tampered fixture
8. Acceptance: FRS-007 AC1–AC6 (ledger), AC1–AC6 (budget)

---

## 9. Related Documents

- FRS-007 (source spec)
- EG-SEC-0002 `docs/TAMPER-PROOF-AUDIT-SPEC.md` (mission-report chaining + AuditLedger_DO — complementary scope)
- `apps/state-engine/TECHNICAL_REPORT.md` (current journal telemetry baseline)
- AGENTS.md (Saga contract for F02-R07)
- IDD-007 (interface contracts and intent)
