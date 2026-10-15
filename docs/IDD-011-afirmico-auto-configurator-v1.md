# Interface Design Document (IDD): AFIRMICO Auto — Configurator Page

**Document ID:** IDD-011  
**Version:** 1.3  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-16  
**Spec:** FRS-010 v4.0 (FEATURE-15, FEATURE-12, FEATURE-13, FEATURE-14, FEATURE-16)  
**Design:** SDD-011 v1.3, SDD-010 v1.14

---

## 1. Purpose

The configurator page is the operator's single interface for viewing and
adjusting per-field telemetry collection. This document records the interface
contract the page exposes: routes, session handling, table components, inline
script delivery, and the sort API.

## 2. Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/admin/telemetry/configurator` | GET | admin session | Renders the configurator page |
| `/admin/telemetry/stage` | POST | admin session | Stages a config scope change |
| `/admin/telemetry/enrol` | POST | admin session | Enrols a catalog field |
| `/admin/telemetry/apply` | POST | admin session | Applies staged configuration |
| `/admin/telemetry/groups` | GET | admin session | Lists vehicle groups |

### 2.1 Query parameters

| Parameter | Type | Values | Default |
|-----------|------|--------|---------|
| `scope` | string | `global`, `group`, `vehicle` | `global` |
| `group` | string | group id | — |
| `vin` | string | vehicle VIN | — |
| `q` | string | search query | — |

## 3. Authentication

The page requires an `afirmico_admin` session cookie, obtained by POSTing the
ingest shared secret to `/admin/login`. The session is opaque (a random id
mapping to a KV entry), never the secret itself. Unauthenticated requests
redirect to `/admin/login` (303).

## 4. Components

### 4.1 Table: config-table

Renders the effective configuration for the selected scope.

| Column | Header | Sort key | Sortable | Source |
|--------|--------|----------|----------|--------|
| Name | Name | `name` | yes | catalog `display_name` |
| Capability | Capability | `capability` | yes | catalog `capability` |
| Property | Property | `property` | yes | catalog `property` |
| Type | Type | `type` | yes | catalog `data_type` |
| Description | Description | `description` | yes | catalog `description` |
| Transport | Transport | `transport` | yes | derived: `vehicle_data_equivalent IS NOT NULL → PULL, else PUSH` |
| Tesla Package | Tesla Package | `package` | yes | catalog `collection_tier` |
| Sampling (s) | Sampling (s) | `sampling` | yes | config `interval_seconds` (numeric) |

**Invariants:**
- Each sortable header carries `data-sort="<key>"`.
- Each sortable header contains an empty `<span class="sort-indicator">` element.
- The indicator span has CSS `display:inline-block`.
- Transport is read-only. It is derived, not set by the operator.

### 4.2 Table: enrol-table

Renders catalog fields not yet collected, available for enrolment.

| Column | Header | Sort key | Sortable |
|--------|--------|----------|----------|
| Field | Field | `field` | yes |
| Category | Category | `category` | yes |
| Description | Description | `description` | yes |
| Enrol | Enrol | — | no (checkbox form) |

### 4.3 Enrolment form

Each enrol row contains a single checkbox form posting to `/admin/telemetry/enrol`
with `field_key` and `enrol=1`. The form submits on change.

## 5. Sort API

### 5.1 `initTableSort(tableId: string): void`

Attaches click listeners to every `th[data-sort]` in the table. Idempotent:
calling it twice on the same table id attaches listeners once (the table is
looked up by id, and the forEach re-attaches — safe because listeners are
not deduplicated but the sort operation is deterministic).

**Contract:**
- Reads `table.querySelector('tbody')` — returns silently if no tbody.
- Sorts are in-place DOM moves (re-append), not re-renders.

### 5.2 `sortTable(idx: number, key: string): void`

Sorts the table body by cell index `idx` using `compare()`.

**Contract:**
- Toggles ascending/descending on repeated clicks on the same key.
- Clears indicators on all headers, sets ▲ or ▼ on the active header.
- Numeric detection via `parseFloat` — two numeric cells sort numerically.

### 5.3 `compare(a, b, idx, asc): number`

Comparison function for `Array.sort()`.

**Contract:**
- Trims cell text before comparison.
- If both values parse as numbers, sorts numerically (`numA - numB`).
- Otherwise sorts via `localeCompare`.
- Reverses for descending.

## 6. Inline script delivery

### 6.1 Delivery mechanism

All inline scripts are delivered as TypeScript template literals in
`src/admin.ts`, concatenated into the page HTML inside `<script>` tags.

### 6.2 Constraint: scripts MUST parse

Because the scripts are strings, TypeScript cannot check their syntax.
Every inline script MUST pass `node --check`. CI extracts all inline
`<script>` blocks from rendered admin pages and syntax-checks each one
(F15-R06, enforced by `test/scripts-syntax.test.ts`).

### 6.3 Constraint: no duplicate declarations

A `const` or `let` declaration MUST NOT appear twice in the same function
scope. A duplicate declaration is a SyntaxError that prevents the entire
enclosing script from executing, silently disabling every feature in it.
(This was the 2026-10-10 incident: the sort script was dead on arrival.)

## 7. Data flow

```
Operator clicks <th data-sort>
  → sortTable(idx, key)
    → reads tbody rows
    → compare(a, b, idx, asc) per row pair
    → rows.sort()
    → tbody.appendChild(row) for each (DOM move)
    → update indicators
```

No network request. No state mutation. No URL change.

## 8. Out of scope

Server-side sorting, pagination, column reordering, persisted sort state,
and any mutation of the configuration data model (FEATURE-12's concern).

## 9. Apply & Canary Contract (added v1.1, 2026-10-13)

The apply sweep is the configurator's only path from a staged target to a
vehicle. Contract as built (`src/config-apply.ts`, wiring in `src/admin.ts`).

### 9.1 Endpoint

```
POST /admin/telemetry/apply        (admin session; tenant-scoped)
form: scope = global | group | vehicle
      canary_vin   REQUIRED when scope is global or group
      vin          the changed vehicle when scope is vehicle
response 200:
  { success: boolean,            // !canaryFailed
    runId: string,               // config_apply_run.run_id
    canaryVin: string | null,
    canaryFailed: boolean,
    outcomes: [...] }            // per-vehicle rows
response 400: { error }          // canary_vin missing for global/group
```

### 9.2 Run state machine — `config_apply_run`

| Column | Meaning |
|--------|---------|
| `run_id` | primary key, referenced by every outcome row |
| `scope_id` | the scope whose staged target was applied |
| `status` | `pending → canary → (canary_failed \| rolling) → completed \| failed \| halted` |
| `canary_vin` | the F12-R07-eligible vehicle nominated for first application |
| `canary_state` | WHICH verification condition failed — a halt is diagnosable, never a bare `failed` |
| `started_at` / `finished_at` / `initiated_by` / `note` | audit trail |

### 9.3 Outcome rows — `config_apply_outcome` (PK: run_id + vin)

| Column | Meaning |
|--------|---------|
| `outcome` | `applied \| verified \| skipped \| failed \| halted` |
| `skip_reason` | F02-R11 vocabulary (`missing_key`, `unsupported_hardware`, `unsupported_firmware`, `max_configs`) |
| `has_config` / `synced` / `observed_after` | F12-R08's three conditions **stored as data**: POST succeeded ∧ `has_config=1` ∧ `synced=1` ∧ a telemetry fact observed afterwards |
| `error_detail` / `applied_at` | failure diagnosis; application time |

### 9.4 Invariants

1. **Eligibility (F12-R07):** the canary MUST carry no vehicle-scope override for any changed field — an override shadows the applied scope and would fake a pass.
2. **Verification (F12-R08):** `verified` requires all three stored conditions; `synced` alone is never sufficient (a vehicle with no target config also reports `synced`).
3. **Halt (F12-R09):** `canaryFailed` stops the run — remaining vehicles keep their previous configuration; `success` is false in the response.
4. **No run without evidence:** every response `runId` MUST resolve to rows in both tables; a run with zero outcome rows is a defect, not an empty fleet.

Out of scope here: eligibility computation UI, interval/seed policy (SDD-011),
signer transport (SDD-010 §2).

---

## 10. Distributed Apply Contract (FEATURE-16, added v1.2, 2026-10-13)

For fleets >1,000 vehicles the cron path is replaced by a Cloudflare Queues fan-out. The console contract changes:

### 10.1 Endpoint (queue path)

```
POST /admin/telemetry/apply        (admin session; tenant-scoped)
form: scope = global | group | vehicle
      canary_vin   REQUIRED when scope is global or group
      vin          the changed vehicle when scope is vehicle
response 200:
  { success: true,               // enqueued, not completed
    runId: string,               // config_apply_run.run_id
    queued: number,              // number of VINs enqueued
    message: string }            // "Apply sweep enqueued. The canary will be processed on the next cron tick..."
response 400: { error }          // canary_vin missing for global/group
```

The response no longer contains outcomes — the apply is asynchronous. The console MUST poll `/admin/telemetry/apply-runs?runId=...` for progress.

### 10.2 Progress endpoint

```
GET /admin/telemetry/apply-runs?runId=...
response 200:
  { runId, status, canaryVin, canaryState,
    queued: number,
    done: number,
    failed: number,
    halted: number,
    inProgress: number,
    vehicles: [ { vin, position, status, outcome, errorDetail } ] }
```

`status` is `pending | canary | rolling | completed | halted`. The console renders per-VIN progress from this, never from logs.

### 10.3 Canary semantics preserved

- The canary is **position 0** in the queue (enqueue order = canary first).
- The queue consumer processes position-0 messages of each run before any other position of that run.
- If the canary fails, the run is marked `halted`; every pending message of that run acknowledges `halted` on its next delivery attempt — no vehicle past position 0 is touched (F12-R09 preserved).
- A failed canary writes its failed condition to `canary_state` so the halt is diagnosable.

### 10.4 Retry & dead-letter

- Transient failures (Tesla 5xx, network) retry up to 3× with exponential backoff (5 min, 15 min, 60 min).
- Permanent failures (4xx, revoked token, invalid VIN) dead-letter immediately to `config_apply_dead_letter`.
- A dead-lettered VIN does not block the run — the console shows it as `failed` with the error detail.
- Dead-letter queue bounded at 10k messages; non-empty triggers an operator alert.

### 10.5 Invariants (additive)

5. **Token freshness (F16-R06):** member access tokens are resolved per VIN at processing time, not at enqueue time.
6. **Idempotency (F16-R08):** re-running an apply writes a NEW `run_id`; `config_apply_outcome` keys on (run_id, vin) so prior runs are not corrupted.
7. **Progress from D1 (F16-R04):** the console reads `config_apply_queue` and `config_apply_outcome` — no worker logs required.

---

## 11. Apply-Contract Corrections (added v1.3, 2026-10-16)

Seven defects in the apply path were found and fixed in production
(PRs #269–#275, FRS-010 v4.0). Each changed a concrete interface
behaviour. The corrections below supersede §9 and §10 where they
overlap; the canary, halt and idempotency invariants still hold.

### 11.1 Run-row INSERT columns (PR #269)

The three INSERTs that create a `config_apply_run` (enqueue, the
queue consumer, and the apply processor) wrote pre-migration column
names and a `pending` status that the `config_apply_run` CHECK
constraint rejects. Every apply returned HTTP 500 before any vehicle
was touched. The inserts now write the migration-0023 columns:

```sql
INSERT INTO config_apply_run (run_id, scope_kind, operator, status, started_at, created_at)
VALUES (?, ?, ?, 'running', ?, ?)
```

`status` is `running` at creation, never `pending`.

### 11.2 Apply POST body shape (PR #270)

The queue-driven apply POSTed a flat body `{vins, fields}`. The
`tesla-http-proxy` signs the `config` sub-object, so a flat body
panicked the proxy (`assignment to entry in nil map` at `jwt.go:45`)
and returned HTTP 502. The apply body MUST be:

```json
{
  "vins": ["<vin>"],
  "config": { "hostname": "...", "port": 443, "ca": "...", "fields": { ... } }
}
```

The proxy signs `config`; `vins` selects the targets.

### 11.3 `canary_vin` at enqueue (PR #271)

`canary_vin` was NULL at enqueue, so the canary gate never fired and
runs stuck in `running`. The canary is queue **position 0**, and
`canary_vin` is written into `config_apply_run` at enqueue time, not
derived later. The progress endpoint (`§10.2`) returns `canaryVin`
from the run row.

### 11.4 Per-VIN isolation (PR #272)

A throw from one VIN's processing killed the whole cron tick, stranding
every later vehicle in the run. `processOneVehicle` wraps each VIN in
its own try/catch so one vehicle's failure cannot strand the rest of
the run.

### 11.5 Verification column + outcome UPSERT (PR #273)

Verification queried a non-existent `captured_at` column, and the
outcome INSERT violated the `(run_id, vin)` primary key on re-runs.
The telemetry-observed check now reads `observed_at`, and the outcome
write is an UPSERT:

```sql
INSERT INTO config_apply_outcome (run_id, vin, ...)
VALUES (?, ?, ...)
ON CONFLICT (run_id, vin) DO UPDATE SET ...
```

### 11.6 Diagnostic GET response parse (PR #274)

The diagnostic GET read `has_config` and `synced` at the top level of
the response. The signer wraps Tesla's response as `{response: {...},
error: ...}`, and Tesla's per-VIN GET returns `{synced, config|null}`
with **no `has_config` field**. `getVehicleConfigStatus` now unwraps
`body.response` and derives the F12-R08 conditions:

- `has_config` = `response.config != null` (a non-null config is the
  vehicle holding a configuration)
- `synced` = `response.synced === true`

Before this correction a canary could never verify, because both
values read as `undefined` and then `false`.

### 11.7 Parked-canary verification fallback (PR #275)

F12-R08 requires a telemetry fact observed after the run's start. A
parked canary can never satisfy that, so legitimate applies halted
forever. `verifyAdoption` now falls back to the earliest
`applied_at` for the VIN in `config_apply_outcome`: a re-apply of an
already-adopted config verifies on existing evidence. A first-ever
apply on a vehicle with no prior outcome still requires a fresh
observation.
