# Interface Design Document (IDD): AFIRMICO Auto — Configurator Page

**Document ID:** IDD-011  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-10  
**Spec:** FRS-010 v2.4 (FEATURE-15, FEATURE-12)  
**Design:** SDD-011

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
