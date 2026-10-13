# Interface Design Document (IDD): AFIRMICO Auto — Configurator Page

**Document ID:** IDD-011  
**Version:** 1.1  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-13  
**Spec:** FRS-010 v2.8 (FEATURE-15, FEATURE-12, FEATURE-13, FEATURE-14)  
**Design:** SDD-011 v1.2, SDD-010 v1.13

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
