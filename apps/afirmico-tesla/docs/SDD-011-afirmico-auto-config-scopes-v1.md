# System Design Document (SDD): AFIRMICO Auto — Telemetry Configuration Scopes

**Document ID:** SDD-011  
**Version:** 1.1  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-09  
**FRS Reference:** [FRS-010 v2.3](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md) — FEATURE-12 (F12-R01..R18, F12-N01..N05)  
**Source:** Owner decisions 2026-10-07 (ten numbered answers) and 2026-10-09 (configurator UX answers 1–12); reference UI review ("Auto API for Tesla — Admin Global Configurator" screenshot, OCR-extracted, `apps/afirmico-tesla/`); measured against the live Tesla surface (`/admin/telemetry/diagnose`, Drogon `LRW3F7ET1SC584656`).

**Revision note (v1.1, 2026-10-09).** Five requirements join the FRS (F12-R14..R18) and this design answers each of them. The scope engine, the apply sweep and the wire artifact from v1.0 do not change. The amendments cover the console's table model, the transport badge, the seed values, the selectors and catalog enrolment. §12 records them as a delta so the v1.0 text stays readable as written.

---

## 1. Scope

This SDD covers **FEATURE-12** only: making the telemetry configuration operator-configurable at
**global**, **group** and **per-vehicle** scope, resolved most-specific-wins and sparse, with a
staged-then-applied workflow and an eligible canary before any scoped rollout.

It does **not** cover the transport, the relay, ingest, derivation, or the catalog. Those are SDD-010
and remain as designed there.

### 1.1 What this supersedes

SDD-010 is **left unamended**. It is the design of record for the phase in which it was written, and a
specification is a log of what was true, not state to be retrofitted. Its interval references (6 hours,
`interval_seconds: 21600`) were accurate when written; the interval is now 180 s (PR #194,
2026-10-07). This section is the explicit supersession record instead of a silent rewrite.

| Area | SDD-010 design (superseded) | This SDD (SDD-011) |
|------|----------------------------|--------------------|
| Interval source | One constant, `SYNC_INTERVAL_SECONDS` in `src/vehicle-config.ts`, applied to every field of every vehicle | Per-field values resolved from a three-level scope stack; the constant remains only as the **seed** for the global tier |
| Granularity | Global by construction — a vehicle cannot differ from the fleet | `vehicle > group > global`, sparse |
| To change a value | Code change → PR → merge → deploy | Stage in the console → apply through CI |
| Visibility of what a vehicle runs | Only by reading D1 | Effective value **and provenance** per field, per vehicle (F12-R10) |
| Drift between staged and applied | Not modelled — nothing was staged | First-class visible state (F12-R11) |
| Apply at fleet scale | Single request looping all VINs | Scheduled sweep, asynchronous, per-vehicle progress (F12-N04, R-18) |
| Pull/Push transport controls | Not applicable | **Deliberately absent** (F12-R12) — push-only transport |

**One thing this SDD does NOT supersede:** the *artifact*. `buildTelemetryConfig()` and the
`{field: {interval_seconds, minimum_delta}}` wire shape are unchanged. What changes is where the values
come from, not what is sent.

---

## 2. Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tier 1 — Cloudflare Worker (apps/afirmico-tesla)                             │
│                                                                              │
│   ┌────────────────────┐   ┌─────────────────────┐   ┌────────────────────┐ │
│   │ Admin console      │   │ Resolution engine   │   │ Artifact builder   │ │
│   │ (READ-ONLY)        │──▶│ resolveConfig()     │──▶│ buildTelemetry     │ │
│   │ • effective values │   │ global>group>vehicle│   │ Config()           │ │
│   │ • provenance       │   │ sparse, total base  │   │ (UNCHANGED shape)  │ │
│   │ • drift display    │   └──────────┬──────────┘   └─────────┬──────────┘ │
│   │ • STAGING (writes  │              │                        │            │
│   │   target rows only)│              │                        │            │
│   └────────────────────┘              │                        │            │
│                                       ▼                        ▼            │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ D1 (afirmico-tesla)                                                  │  │
│   │  configuration scopes        applied/audit          telemetry        │  │
│   │  • telemetry_config_scope    • config_apply_run     • fact/batch     │  │
│   │  • telemetry_config_entry    • audit_event          • snapshot       │  │
│   │  • vehicle_group(_member)    • telemetry_config  (existing, and the  │  │
│   │                                                    source of truth   │  │
│   │                                                    for APPLIED state)│  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                       │                                      │
│   ┌────────────────────┐              │                                      │
│   │ Apply sweep        │◀─────────────┘   scheduled / queue-driven            │
│   │ (async, canaried)  │   ── NOT an in-request loop (F12-N04, R-18)          │
│   └─────────┬──────────┘                                                   │
└─────────────┼──────────────────────────────────────────────────────────────┘
              │ 1. POST fleet_telemetry_config per VIN (member token)
              ▼
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│ Tier 2b — signer            │        │ Tesla Fleet API                      │
│ tesla-http-proxy            │───────▶│ • fleet_telemetry_config (POST/GET)  │
│ signs the JWS, forwards     │        │ • fleet_status                       │
│ (F02-R11)                   │        └──────────────┬───────────────────────┘
└─────────────────────────────┘                       │ target config
                                                      ▼
                                          ┌───────────────────────────────┐
                                          │ Vehicle adopts on next        │
                                          │ backend connection            │
                                          │ → synced:true + telemetry     │
                                          └───────────────────────────────┘
```

### Boundary rules

> **Boundary rule 1 — the console does not apply.** The admin surface may write **staging** rows
> (a target scope and its entries). It MUST NOT write `tesla_telemetry_config`, MUST NOT call the
> signer, and MUST NOT cause any vehicle to be reconfigured. The only actor that applies is the sweep.
> This preserves the read-only property F09 and the console are built on, which a test asserts on
> `/admin/members`.

> **Boundary rule 2 — `tesla_telemetry_config` remains the sole record of *applied* state.** The scope
> tables record what is *desired*. Nothing derives "applied" from the scopes; the two are compared to
> produce drift (F12-R11). A second writer of applied state is the drift bug this repo has already been
> bitten by (the wide read model was made a VIEW for exactly this reason).

> **Boundary rule 3 — the sweep is the only place a config is sent.** `sendVehicleConfig()` keeps its
> single caller (`POST /admin/telemetry/apply`) during the transition, and the sweep becomes the second
> — with the endpoint reduced to a canary-only path. Two independent send paths would mean two different
> audit trails.

> **Boundary rule 4 — resolution is pure.** `resolveConfig()` is a pure function of
> (global entries, group entries, vehicle entries, catalog). It performs no I/O, so its determinism
> (F12-N01) is testable without a database and cannot vary with request order.

---

## 3. Data Flow

### 3.1 Operator stages a change

1. Operator → opens `/admin/telemetry/configurator` → selects a scope (global / a group / a vehicle).
2. Console → reads current **effective** values and provenance (read-only).
3. Operator → edits `interval_seconds` / `minimum_delta` / enabled for one or more fields.
4. Console → writes **staging rows only** (`telemetry_config_entry` for that scope) → records an
   audit event naming the operator, scope and prior→new values.
5. Console → shows the change as **drift** ("staged, not applied"). No vehicle is touched.
   *(F12-R05, F12-N03, F12 AC5, AC10.)*

### 3.2 An apply is triggered

6. A change is committed and applied by the pipeline — the sweep is scheduled, not run inside the
   request (F12-N04).
7. Sweep → creates `config_apply_run` (scope, status) → resolves the **target set** of VINs.

### 3.3 Canary (global and group only)

8. Sweep → selects the **operator-nominated** canary, then **checks eligibility**: the nominated VIN
   MUST NOT carry a vehicle override for any field the change touches. If it does, the nomination is
   **refused with that reason** rather than silently substituted — an operator who nominated a vehicle
   needs to know why it was rejected. *(F12-R07; owner decision 2026-10-07: operator-nominated, with
   eligibility enforced.)*
9. Sweep → applies to the canary only → polls `fleet_telemetry_config` **and** `fleet_status`.
10. Sweep → verifies **all three** conditions: POST succeeded; `has_config: true` **and**
    `synced: true`; and a subsequent telemetry observation arrived for that VIN. *(F12-R08 — see §6
    Invariant 4 for why `synced` alone is insufficient.)*
11. On failure → **halt**, record the failed condition per vehicle, leave remaining vehicles untouched
    (F12-R09, F12 AC8).

### 3.4 Fleet rollout

12. Canary verified → sweep → applies to remaining VINs, **bounded concurrency**, one row per VIN in
    the run, recording outcome per vehicle.
13. Sweep → writes/updates `tesla_telemetry_config` per VIN from the outcome (Boundary rule 2), so drift
    resolves to zero.
14. Sweep → completes `config_apply_run` with per-vehicle outcomes; the console reads it for progress.

### 3.5 Vehicle-scoped change

15. Operator → stages a vehicle-scope entry → apply → sweep applies to **that VIN only**. No canary:
    the apply is single-vehicle and is therefore its own canary (F12-R07).

### 3.6 Drift is read, not stored

16. Console → resolves desired (scopes) and reads applied (`tesla_telemetry_config`) → renders the
    difference. Drift is **computed on read**, never written, so it cannot go stale.

---

## 4. Data Structures

### 4.1 The wire artifact — UNCHANGED

No change to what Tesla receives. Included so a reader can confirm the boundary:

```json
{
  "vins": ["LRW3F7ET1SC584656"],
  "config": {
    "hostname": "telemetry.afirmi.co",
    "port": 443,
    "ca": "-----BEGIN CERTIFICATE-----\n...",
    "fields": {
      "Odometer":                   { "interval_seconds": 180, "minimum_delta": 0.1 },
      "MilesSinceReset":            { "interval_seconds": 180, "minimum_delta": 1 },
      "SelfDrivingMilesSinceReset": { "interval_seconds": 180, "minimum_delta": 1 },
      "Trim":                       { "interval_seconds": 180 }
    }
  }
}
```

Fields built in **sorted key order** so a change is a reviewable diff (F12-N01). `minimum_delta` is
emitted only where the catalog sets it and the tier is not `once` — unchanged from today.

### 4.2 Scope tables (new)

```sql
-- A configuration scope: the global default, a group, or one vehicle.
-- Exactly one of group_id / vin is set; both NULL means the global default,
-- which is required to exist and to be total (F12-R02).
CREATE TABLE telemetry_config_scope (
  scope_id    TEXT PRIMARY KEY,
  scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('global','group','vehicle')),
  group_id    TEXT REFERENCES tesla_vehicle_group (group_id) ON DELETE CASCADE,
  vin         TEXT REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  -- A scope identifies exactly one subject, and the kind must match it.
  CHECK ((scope_kind = 'global'  AND group_id IS NULL     AND vin IS NULL)
      OR (scope_kind = 'group'   AND group_id IS NOT NULL AND vin IS NULL)
      OR (scope_kind = 'vehicle' AND vin IS NOT NULL      AND group_id IS NULL))
);
-- At most one scope row per subject, so resolution has no ambiguity to break ties on.
CREATE UNIQUE INDEX idx_scope_global  ON telemetry_config_scope (scope_kind) WHERE scope_kind = 'global';
CREATE UNIQUE INDEX idx_scope_group   ON telemetry_config_scope (group_id)  WHERE group_id  IS NOT NULL;
CREATE UNIQUE INDEX idx_scope_vehicle ON telemetry_config_scope (vin)       WHERE vin       IS NOT NULL;

-- One entry per (scope, field). SPARSE: a field with no row at this scope INHERITS
-- from the level above. `enabled = 0` is a deliberate value meaning "do not collect",
-- which is NOT the same as "no row" -- that distinction is the whole reason this is
-- a row rather than a deleted row.
CREATE TABLE telemetry_config_entry (
  scope_id          TEXT NOT NULL REFERENCES telemetry_config_scope (scope_id) ON DELETE CASCADE,
  field_key         TEXT NOT NULL REFERENCES tesla_field_catalog (field_key),
  interval_seconds  INTEGER NOT NULL CHECK (interval_seconds > 0),
  minimum_delta     REAL,                -- NULL = no delta gate at this scope
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (scope_id, field_key)
);
```

```sql
-- Group scope is a first-class, owner-curated entity (R-17 resolution, v2.1),
-- NOT a binding to F06's derived segment keys. The derived key is an OUTPUT,
-- recomputed per export; a scope bound to it would silently stop applying when
-- the derivation changed.
CREATE TABLE tesla_vehicle_group (
  group_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE tesla_vehicle_group_member (
  group_id  TEXT NOT NULL REFERENCES tesla_vehicle_group (group_id) ON DELETE CASCADE,
  vin       TEXT NOT NULL REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, vin)
);
```

### 4.3 Apply-run tables (new)

```sql
-- One row per apply invocation. The evidence that a change was applied (F12-R06).
CREATE TABLE config_apply_run (
  run_id        TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES telemetry_config_scope (scope_id),
  status        TEXT NOT NULL CHECK (status IN ('pending','canary','canary_failed','rolling','completed','failed','halted')),
  canary_vin    TEXT,
  canary_state  TEXT,      -- the specific condition that failed, when it did
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  initiated_by  TEXT,
  note          TEXT
);

-- Per-vehicle outcome. `verified_condition` records WHICH condition passed/failed
-- so a halt is diagnosable rather than a bare 'failed'.
CREATE TABLE config_apply_outcome (
  run_id             TEXT NOT NULL REFERENCES config_apply_run (run_id) ON DELETE CASCADE,
  vin                TEXT NOT NULL,
  outcome            TEXT NOT NULL CHECK (outcome IN ('applied','verified','skipped','failed','halted')),
  skip_reason        TEXT,   -- reuses the F02-R11 vocabulary (missing_key, ...)
  error_detail       TEXT,
  has_config         INTEGER,
  synced             INTEGER,
  observed_after     INTEGER,   -- did a telemetry observation follow?
  applied_at         TEXT,
  PRIMARY KEY (run_id, vin)
);
```

### 4.4 Resolution output shape

```ts
interface ResolvedField {
  field_key: string
  enabled: boolean
  interval_seconds: number
  minimum_delta: number | null
  /** Which scope supplied the winning value. Required by F12-R10. */
  source: 'global' | 'group' | 'vehicle'
  /** The scope_id that won, so the console can link to the row an operator edits. */
  source_scope_id: string
}

interface ResolvedConfig {
  vin: string
  fields: ResolvedField[]
  /** Fields present in the catalog as collected, absent from every scope. F12-R02: these are an ERROR. */
  unresolved: string[]
}
```

---

## 5. File Structure

```text
apps/afirmico-tesla/
  migrations/
    0016_config_scopes.sql          # scope + entry tables, group tables, apply-run tables
    0017_seed_global_scope.sql      # global tier seeded from the catalog at 180 s (total, F12-R02)
  src/
    config-scope.ts                 # resolveConfig(): PURE. global>group>vehicle, sparse, provenance.
    config-apply.ts                 # the sweep: eligibility, canary, verify-all-three, bounded fan-out
    config-groups.ts                # group entity CRUD (owner-curated)
    admin.ts                        # + /admin/telemetry/configurator (READ + STAGING writes only)
    vehicle-config.ts               # buildFieldConfig() takes resolved values, not the constant
    store.ts                        # + scope/entry/run/outcome accessors
  test/
    config-scope.test.ts            # resolution: inheritance, shadowing, sparse, total-base, unresolved
    config-apply.test.ts            # canary eligibility, three-condition verification, halt, idempotency
```

---

## 6. Invariants

1. **The console cannot apply.** No `/admin/*` route writes `tesla_telemetry_config`, calls the signer,
   or reconfigures a vehicle. Only the sweep does. *(Testable: the existing read-only test extends to
   the configurator's routes, allowing staging-table writes only.)*

2. **Resolution is deterministic and pure.** The same scope rows and catalog produce a byte-identical
   `ResolvedConfig`, independent of query order. *(Testable without a database.)*

3. **The global scope is total.** Every field with `collected = 1` has a global entry. A field present
   in the catalog and absent from every scope appears in `unresolved` and **no artifact is built**
   (F12-R02, AC2). *(Testable: delete a global entry, assert the build refuses rather than omitting.)*

4. **`synced: true` is not adoption.** Verification requires `has_config = true` **and**
   `synced = true` **and** a subsequent telemetry observation. Measured basis: `5YJ3F7EB7LF697834`
   reports `synced: true` with `has_config: false` and `key_paired: false` — a **failed** config reading
   as adopted. A canary check on `synced` alone would pass a failure. *(F12-R08, corrected v2.1.)*

5. **An override may narrow, never widen.** The effective enabled set is a subset of
   `CONSENTED_FIELDS`; an entry that would enable a field outside it is refused **before** an artifact is
   built, and CI fails on it (F12-R04, AC4). *(Testable: seed a widening entry, assert refusal.)*

6. **Drift is computed, never stored.** Nothing writes a "desired" copy into
   `tesla_telemetry_config`; the applied record has exactly one writer (the sweep) (Boundary rule 2).

7. **A canary is eligible or the nomination is refused.** A vehicle carrying a vehicle-scope entry for a
   hinted field is not eligible; the refusal names the field (F12-R07, AC7).

8. **A failed canary halts.** No remaining vehicle is touched, and the run records the specific
   condition that failed (F12-R09, AC8).

9. **Unit-only applies skip the canary.** `scope_kind = 'vehicle'` applies directly; the canary stage is
   not entered (F12-R07).

10. **Re-apply is idempotent.** Applying the same resolved config twice produces one outcome per VIN and
    leaves no vehicle indeterminate (F12-R09).

---

### 6.5 Sort Implementation (FEATURE-15)

The configurator page exposes two sortable tables (`config-table` and `enrol-table`).
Sorting is a client-side read-only operation with no server state change.

**Architecture:**
- The sort logic is a single IIFE appended to the page as an inline `<script>` block.
- `initTableSort(tableId)` attaches click listeners to every `th[data-sort]`.
- `sortTable(idx, key)` sorts the `<tbody>` rows in place via DOM re-append.
- `compare(a, b, idx, asc)` handles numeric vs text columns:
  - Numeric detection via `parseFloat` on trimmed cell text.
  - Numeric columns sort numerically (e.g., 180 < 21600 < 604800).
  - Text columns sort via `localeCompare`.
- Sort indicators (`▲` / `▼`) update on the active header; others clear.

**Why this design:**
- No re-render: the server already built the full table; moving DOM nodes is faster
  than re-requesting HTML and avoids the flash of a full page reload.
- Deterministic: the same table content + same column + same direction always yields
  the same row order. No server round-trip means no race condition.
- Zero backend change: the FRS requirement is purely presentational.

**Syntax guarantee (F15-R06):**
Because the script is a TypeScript template literal, tsc cannot check it.
A CI test (`test/scripts-syntax.test.ts`) renders every admin page, extracts all
inline `<script>` blocks, and runs `node --check` on each. A syntax error fails
the build. This gate was added after the 2026-10-10 incident where a duplicate
`const headers` declaration prevented the entire sort script from executing
while every other gate stayed green.

**CSS contract (F15-R04):**
The indicator span MUST have `display:inline-block` so it occupies layout space
and is visible. Without this, the ▲/▼ are collapsed to zero width and the
operator sees no indication of sort state.

**Performance (F15-N01):**
500 rows × 8 columns sorts in <50 ms on modern hardware. The algorithm is
`Array.sort` with a comparison function — O(n log n) with minimal constant
factor.

---

## 7. Failure Modes

| Failure | Detection | Handling |
|---|---|---|
| Catalog has a collected field with no global entry | Resolver returns `unresolved` (non-empty) | **Refuse to build**; report the fields. Not a silent omission (F12-R02) |
| Nominated canary carries an override for a hinted field | Eligibility check | Refuse the nomination, naming the field; operator nominates another (F12-R07) |
| Canary POST succeeded, vehicle not adopted | `has_config`/`synced` poll | Halt; record which condition failed; fleet untouched (F12-R08/R09) |
| Canary adopted but stream stopped | No telemetry observation after apply | Halt and flag; this is the failure mode a response-based check cannot see |
| **`synced: true` with no config** | `has_config = false` with `synced = true` | Treat as NOT adopted — the measured false-positive (§6 Inv 4) |
| Override would enable a field outside the consented set | Pre-build gate + CI | Refuse before any artifact exists (F12-R04) |
| Member token missing / expired mid-sweep | Token read fails per VIN | Record per-vehicle `failed`; continue the sweep (F04-R11 isolation) |
| Sweep exceeds its time budget | Per-vehicle progress stalls | Resume from recorded outcomes; re-run is idempotent (F12-R09) |
| Group deleted while a scope references it | `ON DELETE CASCADE` + FK | Scope rows go with it; resolution falls back to the level above; the run records the VIN set it actually used |
| Operator stages a change and never applies it | Drift display | Visible as staged-not-applied; no vehicle effect (F12-N03, AC10) |

---

## 8. Verification Strategy

Each step is labelled by what it needs. The bulk is locally verifiable, which is deliberate —
the earlier phases' lesson was that one externally-gated step can re-gate a whole plan.

**Locally verifiable (no vehicle, no Tesla API):**

1. Resolution: inheritance, shadowing, sparse inheritance, provenance correctness — pure function, no DB.
2. Total-base: a collected field absent from every scope yields `unresolved` and refuses the build.
3. Narrow-only: a widening entry is refused pre-build; CI fails on it.
4. Authorization: no `/admin` route writes applied state or calls the signer; the configurator's writes
   are limited to staging tables.
5. Canary eligibility: an overridden vehicle is rejected with the field named.
6. Halt: a simulated canary failure leaves remaining vehicles untouched and records the failed condition.
7. Determinism: two resolutions of the same rows are byte-identical; artifact keys are sorted.
8. Idempotency: applying twice yields one outcome per VIN.
9. Drift: staged-not-applied is visible and has no vehicle effect.
10. Migration safety: the new migrations pass `verify-schema` (including the D1 statement-size gate).

**Needs external state (a real paired, in-use vehicle):**

11. Adoption: canary reaches `has_config: true` **and** `synced: true`, **and** a subsequent telemetry
    observation is recorded. **Requires Drogon to connect** — currently `synced: false` pending adoption
    (2026-10-07). This is the one step an operator cannot rush and MUST NOT be simulated: the timer in
    the vehicle is reported not to begin until the configuration is applied and the vehicle connects.
12. Live halt: a deliberately invalid config on the canary stops the rollout in production.

---

## 9. Open Items

| O-N | Item | Owner |
|-----|------|-------|
| O-1 | Bounded concurrency for the sweep at 1,000 vehicles: how many VINs in flight, and the retry backoff against Tesla's per-device rate limits (R-10 limits remain unretrieved). Must be decided before the fleet-wide phase, not before the canary. | Build phase |
| O-2 | Where the sweep runs: a Cloudflare Cron Trigger on the existing `*/5` schedule, or a Durable Object / Queue. Cron is simplest but shares the schedule with the key-pairing poll; a Queue gives per-vehicle retry. Decide when the fleet-wide path is built. | Build phase |
| O-3 | Does the console's staging write require a distinct operator permission from read? Today there is one operator secret. A write surface may warrant separating "view" from "stage". | Warren |
| O-4 | Group membership source: owner-curated only (this design), or seeded from TOCA membership tiers. Deferred — the entity supports either. | Warren |

---

## 10. Related Documents

| Artifact | Relation |
|---|---|
| [FRS-010 v2.1](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md) | Requirements for this design — FEATURE-12 (F12-R01..R12, F12-N01..N05) |
| [SDD-010](./SDD-010-afirmico-auto-telemetry-architecture-v1.md) | **Unamended.** Transport, relay, ingest, derivation, catalog. §1.1 records what this SDD supersedes |
| `apps/afirmico-tesla/src/vehicle-config.ts` | `buildTelemetryConfig()` and `buildFieldConfig()` — the artifact builder this design feeds; wire shape unchanged |
| `apps/afirmico-tesla/src/consent-policy.ts` | `CONSENTED_FIELDS` — the ceiling overrides may narrow and must not widen (F12-R04) |
| `apps/afirmico-tesla/scripts/verify-schema.sh` | Schema assertions incl. the D1 statement-size gate the new migrations must pass |
| `apps/afirmico-tesla/Tesla Fleet API Example - Admin Global Configurator.png` | Reference UI reviewed for this feature. Its Pull/Push column was not adopted at v1.0 (F12-R12). **v1.1 adopts the column as a read-only badge** (§12.1, F12-R15) — a badge reports transport, it does not control it |

---

## 12. Delta (v1.1) — console amendments F12-R14..R18

This section records the design of the five requirements added at FRS v2.3. Sections 1–11 stay as
written at v1.0. Where a delta changes a v1.0 element, the delta wins.

### 12.1 The table model (F12-R14, F12-R15)

The config-entries table joins the scope's entries against `tesla_field_catalog` on `field_key` and
renders one row per collected field with the reference product's column set:

| Column | Source | Widget |
|---|---|---|
| Name | `field_key` | plain text, monospace |
| Capability | `category` | plain text |
| Property | `collection_group` | plain text |
| Type | `value_type`, with `proto_enum_name` appended when non-empty | colour chip keyed on `value_type` |
| Description | `description` | plain text, truncated with title attribute |
| Transport | `vehicle_data_equivalent` non-empty ⇒ `PULL`, else `PUSH` | **read-only badge** |
| Tesla Package | `collection_tier` | plain text badge |
| Sampling Frequency | `interval_seconds` from the resolved entry | inline number input |
| Enabled | `enabled` from the resolved entry | checkbox toggle |

The transport badge derives from the catalog on read. It is never written and never posted. An
attempt to post `transport` in the stage form is ignored, so no code path can treat operator intent
as a transport decision (F12-R15, F14-R01).

The catalog join runs once per page render against `tesla_field_catalog`, which is small (239 rows)
and static between catalog migrations. No cache layer.

### 12.2 Seed values (F12-R16)

Migration 0017's uniform 180 s seed is superseded by a **tiered seed** at the next migration:

| Seed | Fields | `interval_seconds` |
|---|---|---|
| fast | `MilesSinceReset`, `SelfDrivingMilesSinceReset` | 180 |
| poll | `Odometer` | 604800 — this value IS the weekly poll cadence (F14-R04) |
| slow | every other collected field — `PinToDriveEnabled`, `Trim`, `Version`, `CarType`, `EfficiencyPackage`, the ADAS settings, `SentryMode`, `SpeedLimitMode`, `SpeedLimitWarning` | 21600 |

The seed sets **existing global rows only**. It never overwrites a row an operator edited, because
the migration updates rows where `updated_at` still equals the seed's own write timestamp. A fresh
deployment seeds the same values a fresh `SYNC_INTERVAL_SECONDS` path would. `SYNC_INTERVAL_SECONDS`
stays as the constant the fast tier reads, so v1.0's decision (5) survives.

The enabled toggle uses the existing `telemetry_config_entry.enabled` column (added at v1.0).
`enabled = 0` is an entry, not a deletion — the sparse-inheritance rule from §4.2 is unchanged.

### 12.3 Selectors (F12-R17)

**Paired-only filter.** The vehicle dropdown query gains
`JOIN tesla_vehicle_key vk ON vk.vin = v.vin AND vk.key_state = 'paired'`. An unpaired vehicle
cannot receive a configuration (F02-R09's own logic reads it as `unpaired`), so listing one invites
the operator to stage a change that cannot apply. The Vehicles page and the group-member add form
keep their current behaviour — they show fleet inventory, not config targets.

**Search.** Both selectors become server-filtered inputs: `?search=` on the configurator route
filters `tesla_vehicle_group.name LIKE` for groups and `v.vin LIKE OR v.display_name LIKE` for
vehicles, case-insensitive, capped at 50 rows. Client-side filtering was rejected because the fleet
at 1,000 vehicles exceeds a dropdown's useful length.

**Active nav.** `shell()` gains an `active` parameter set by each route. The nav item matching
`active` renders `font-weight:700` with the green accent; every other item renders at default
weight. One source of truth in `shell()`, not per-page markup.

### 12.4 Catalog enrolment (F12-R18)

`POST /admin/telemetry/enrol` accepts a `field_key` from `tesla_field_catalog`. The handler runs
four steps in one transaction:

1. Verify the field exists and `collected = 0`. Enrolling an enrolled field is a no-op 200.
2. Set `collected = 1` and `collection_tier` to the field's catalog default (`once` when the tier
   is `never`).
3. Insert the global-scope entry at the fast-tier seed, so F12-R02's totality holds the moment the
   field joins the set.
4. Write an audit row: action `telemetry_field_enrolled`, actor, `field_key`, timestamp.

The consent-set gate (F01 AC6, F12-R04) reads `CONSENTED_FIELDS` — which is `collected = 1` at
query time — so the gate accepts the field as soon as step 2 commits. No consent-policy bump: the
authorisation text at F14-R06 already covers a varying set. Enrolment is the only route in this
feature that widens the collected set, so it carries its own guard and its own audit action rather
than hiding inside the stage route.

**New invariant (11): enrolment is transactional and audited.** Steps 1–4 either all commit or none
do. A partial enrolment — a field marked collected with no global entry — is the exact state
F12-R02 calls an error, so the transaction boundary is the mechanism that prevents it.
