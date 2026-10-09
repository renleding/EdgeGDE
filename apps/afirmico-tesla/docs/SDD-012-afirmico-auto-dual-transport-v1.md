# System Design Document (SDD): AFIRMICO Auto — Dual-Transport Collection

**Document ID:** SDD-012  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-09  
**FRS Reference:** [FRS-010 v2.3](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md) — FEATURE-14 (F14-R01..R10, F14-N01..N03)  
**Source:** Owner decisions 2026-10-09 (transport tree, poll cadence, wake policy, revocation scope, consent option 2). Catalog facts read from `tesla_field_catalog` (migration 0001 + 0013). FRS-010 R-02 (v1.4) gives the telemetry-only proof on the FSD counters.

---

## 1. Scope

This SDD covers **FEATURE-14**: the second transport lane beside Fleet Telemetry. REST polling of
low-frequency and static fields, fired only as a co-processor of a telemetry ingest, stopped by
revocation, and attributed on every row it writes.

It does **not** cover the scope engine (SDD-011), the telemetry transport itself (SDD-010), or the
configurator's table model (SDD-011 §12). It reads the token lifecycle (F02) and the ingest path
(F04) as built.

### 1.1 What this changes

| Area | Before (v2.2, telemetry-only) | This design |
|---|---|---|
| Transports | Fleet Telemetry, sole lane | Fleet Telemetry + bounded REST polling lane |
| Identity fields (`CarType`, `EfficiencyPackage`, `Version`, `Trim`) | collected once over telemetry, `once` tier | polled once at member first sync, then read from storage |
| `Odometer` | telemetry only, 180 s | telemetry at configured interval AND weekly poll as backstop — see §4.1 conflict rule |
| Sleep behaviour | vehicle sleeps between sends | unchanged for telemetry. The platform never sends `wake_up` for any poll |
| Row attribution | transport implied by table | every row records `source` (`telemetry` or `poll`) |
| Revocation | tears down telemetry config | tears down telemetry config AND stops polling for that member's vehicles |

---

## 2. Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tier 1 — Cloudflare Worker (apps/afirmico-tesla)                             │
│                                                                              │
│  ┌────────────────────┐      ┌──────────────────────────────────────────┐    │
│  │ Telemetry ingest   │      │ Poll coordinator (NEW)                   │    │
│  │ POST /ingest/      │─────▶│ • per-VIN due check (cadence table)      │    │
│  │ telemetry (F04)    │ after│ • identity: only when never polled       │    │
│  │                    │ batch│ • odometer: only when weekly due         │    │
│  └────────────────────┘      │ • NEVER sends wake_up                    │    │
│                              └───────────┬──────────────────────────────┘    │
│                                          │ member refresh token (F02)        │
│                                          ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │ Tesla Fleet API — vehicle_data REST                                  │    │
│  │ GET /api/1/vehicles/{vin}/vehicle_data   (single call, all fields)  │    │
│  │ GET /api/1/vehicles/{vin}/vehicle_config (identity block)           │    │
│  └───────────────────────────────┬──────────────────────────────────────┘    │
│                                  │ polled values                             │
│                                  ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │ Normalisation — SAME path as telemetry (F14-R08)                     │    │
│  │ persistDatums() writes tesla_telemetry_fact with source='poll'       │    │
│  │ once-tier values → tesla_vehicle_snapshot                            │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Cadence state (NEW)                                                         │
│  • telemetry_poll_state: vin, last_poll_at, identity_polled, odometer_due    │
│  Revocation hook (F14-R07): F02-R12 teardown + clear poll eligibility       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Boundary rules

> **Boundary rule 1 — the poll coordinator is a child of ingest.** The only caller of a poll is the
> ingest handler, after `persistDatums()` commits a batch for that VIN. No cron, no queue consumer
> and no admin route may invoke a poll. This is the structural form of F14-R02: a sleeping vehicle
> produces no batches, so it produces no polls, whatever the cadence table says.

> **Boundary rule 2 — no `wake_up` anywhere in this feature.** The coordinator calls
> `vehicle_data` and `vehicle_config` reads only. `vehicle_data` on a sleeping vehicle returns stale
> or empty data — which the normalisation records as "not reported", not as zero. The coordinator
> does not retry against a wake.

> **Boundary rule 3 — polled rows are indistinguishable downstream except by source.** The
> normalisation path is the telemetry path (F14-R08). The single difference is the `source` column
> written on the fact row. Anything that needs to know how a value arrived reads that column.

> **Boundary rule 4 — the transport column in the configurator is a read model.** The badge derives
> from `tesla_field_catalog.vehicle_data_equivalent` at render time (SDD-011 §12.1). Neither lane
> writes transport. F14-R01 holds: transport is catalog data, not configuration.

---

## 3. Data Flow

### 3.1 First sync — identity build (F14-R03)

1. Member completes OAuth → tokens stored (F02 machinery, unchanged).
2. First telemetry batch arrives for a VIN of that member.
3. Coordinator reads `telemetry_poll_state.identity_polled` for the VIN: `0`.
4. Coordinator → `GET vehicle_config` with the member token → `CarType`, `Trim` (trim_badging),
   `EfficiencyPackage`, plus VIN decode for Year.
5. Coordinator → writes the identity fields through normalisation with `source = 'poll'` → sets
   `identity_polled = 1`.
6. Subsequent batches skip step 3's branch. No scheduled job re-polls identity (AC3).

### 3.2 Weekly odometer backstop (F14-R04)

1. After each batch, coordinator reads `last_poll_at`.
2. Due when `now - last_poll_at >= interval_seconds` from the field's resolved config. The seed sets
   `interval_seconds = 604800`, which IS the owner's weekly cadence (F14-R04). The operator may
   override the cadence at any scope through the configurator — shortening it below a week is a
   deliberate operator act recorded as an override, not a default.
3. Not due → return. Due → `GET vehicle_data` → normalise `Odometer` with `source = 'poll'` →
   stamp `last_poll_at`.
4. A week with no batches means no invocations. The row reads `overdue`, never `skipped` (AC4).

### 3.3 Revocation (F14-R07)

1. Member revokes → existing F02-R12 teardown runs (config delete per vehicle, unchanged).
2. Teardown also sets `telemetry_poll_state.identity_polled = -1` (revoked marker) or deletes the
   state row — the design deletes it, so absence of the row means "not eligible".
3. Ingest already refuses consentless members (F04 consent gate), so the coordinator's precondition
   ("this VIN's member has active consent") fails closed even if state rows linger.
4. Audit: the existing revoke audit row plus the teardown rows cover both lanes (AC5).

### 3.4 Billing metering (F14-R09)

Each REST call increments `tesla_signal_counter.data_requests` for the day, alongside the existing
`signals` counter. `/healthz` already reports the billing guard — the projected figure now includes
poll cadence, so a poll-heavy fleet degrades the report before the credit runs out (AC8).

---

## 4. Data Structures

### 4.1 The transport matrix (F14-R01, F14-R05)

Derived from the catalog as it stands. This table is the design's authority on what polls:

| Fields | `vehicle_data_equivalent` | Lane | Cadence |
|---|---|---|---|
| `CarType`, `EfficiencyPackage`, `Version`, `Trim` | present | **poll, once** | first sync only |
| `Odometer` | present (`vehicle_state.odometer`) | **poll + telemetry** | poll at 604800 s (weekly, seeded) / telemetry at configured interval |
| `SentryMode`, `SpeedLimitMode` | present | **telemetry only** | `on_change` (F14-R05 — owner: state change ok) |
| `MilesSinceReset`, `SelfDrivingMilesSinceReset` | **absent** | **telemetry only** | 180 s (F14-R01 — no REST path exists) |
| `PinToDriveEnabled`, `SpeedLimitWarning`, the four ADAS fields | absent | **telemetry only** | 21600 s slow seed (F12-R16) |

**Conflict rule (owner answer 1, settled here).** The FRS question was whether `Odometer` moves
entirely to weekly polling. The FSD counters cannot follow — no REST equivalent exists. `Odometer`
CAN, and the owner chose weekly. This design keeps Odometer on **both** lanes: telemetry delivers
the intra-week signal the driver profile uses, and the weekly poll re-syncs the counter if telemetry
gaps. A field may ride both lanes. A field may never ride polling alone when it has no REST
equivalent.

**Static identity note.** `Year` never polls — `modelYearFromVin()` decodes it from the VIN the
poll already has. `car_special_type` (owner's tree) maps to a catalog row only when the catalog
gains it. Enrolment (F12-R18) is the path.

### 4.2 Cadence state (new)

```sql
-- One row per VIN that has ever been polled. Absent row = not poll-eligible
-- (no consent, or revoked — F14-R07 deletes the row).
CREATE TABLE telemetry_poll_state (
  vin              TEXT PRIMARY KEY REFERENCES tesla_vehicle (vin) ON DELETE CASCADE,
  identity_polled  INTEGER NOT NULL DEFAULT 0 CHECK (identity_polled IN (0,1)),
  last_poll_at     TEXT,        -- last successful vehicle_data poll
  last_identity_at TEXT,        -- when identity was built (for audit)
  updated_at       TEXT NOT NULL
);
```

The first eligible ingest creates the row lazily. Revocation deletes it, and the deletion IS the
eligibility model: no row, no poll (§3.3).

### 4.3 Fact-row source attribution (F14-R10)

```sql
ALTER TABLE tesla_telemetry_fact ADD COLUMN source TEXT
  NOT NULL DEFAULT 'telemetry'
  CHECK (source IN ('telemetry','poll'));
```

Default `'telemetry'` keeps every existing row honest — they all arrived by telemetry. A polled row
writes `'poll'`. Exports (F13), the driver profile (F05) and insurer queries read the column when
they need attribution (AC7).

---

## 5. File Structure

```text
apps/afirmico-tesla/
  migrations/
    0019_poll_state.sql            # telemetry_poll_state + fact.source column
  src/
    poll-coordinator.ts            # NEW — due-check, identity-once, weekly backstop, metering
    telemetry.ts                   # + normalisation accepts a source stamp
    index.ts                       # + ingest handler calls coordinator after persistDatums()
    store.ts                       # + poll-state accessors, revocation clears state
    consent-policy.ts              # unchanged — CONSENTED_FIELDS still reads collected = 1
  test/
    poll-coordinator.test.ts       # due logic, identity-once, wake-free guarantee, source stamp
    poll-revocation.test.ts        # teardown clears eligibility; consentless ingest fails closed
```

---

## 6. Invariants

1. **No poll without a batch.** The coordinator's only call site is inside the ingest handler after
   `persistDatums()` returns. Testable: invoke the coordinator directly — the exported surface does
   not exist. Only the ingest path can trigger it.

2. **No `wake_up` in the feature.** The coordinator's fetch list contains exactly two paths
   (`vehicle_data`, `vehicle_config`). Testable: assert the module's request URLs contain no wake
   endpoint.

3. **Identity polls exactly once per VIN.** `identity_polled` flips 0→1 and never returns. Testable:
   two ingests, one poll.

4. **Transport never comes from an operator.** The badge reads the catalog. The stage form ignores a
   posted `transport`. Testable: post `transport=PULL`, assert the artifact for a no-equivalent
   artifact for a no-equivalent field holds the same value.

5. **FSD counters never poll.** Fields with a NULL `vehicle_data_equivalent` are absent from the
   coordinator's poll candidate set — SQL builds the set by joining the catalog on a non-null
   equivalent. Testable: seed a candidate set, assert the two counters are absent (AC1).

6. **Revocation stops both lanes.** Teardown deletes `telemetry_poll_state` rows for the member's
   VINs. Ingest's consent gate fails closed independently. Testable: revoke, ingest, assert no poll
   attempt and audit rows for both events (AC5).

7. **Every poll row carries `source = 'poll'`.** Testable: one poll, assert the fact row's column.

8. **Metered.** Each REST call increments `data_requests`. Testable: counter moves per call (AC8).

---

## 7. Failure Modes

| Failure | Detection | Handling |
|---|---|---|
| Member token expired at poll time | `refreshTokens()` fails (F02) | record the poll as failed in state, do not retry until the next batch, do not wake the vehicle |
| `vehicle_data` returns empty (car asleep, request raced the batch) | no fields in response | normalise records "not reported", not zero. `last_poll_at` does NOT stamp — the poll is still due next batch |
| Poll returns fields outside the consented set | filter intersects response with `collected = 1` | drop the extras silently at normalisation — the API returns whole blocks, consent narrows on write |
| Identity poll returns a different `CarType` than the stored snapshot | compare before write | write the new value with `source = 'poll'` and audit — the vehicle's report wins over our store |
| `telemetry_poll_state` row missing after weeks of telemetry | left join shows NULL | create the row lazily on this batch, identity_polled = 0, so the next step builds identity |
| Revocation races an in-flight poll | state row deleted mid-request | the write path checks consent again before persisting (F04 gate), so a late response lands nowhere |
| Poll cadence projects over the billing credit | `/healthz` guard | degrade the health report (AC8). No automatic throttling at MVP — operator reads the report |
| Catalog gains `car_special_type` later | enrolment path (F12-R18) | enrol, global seed lands, next first-sync cohort polls it. Existing members keep their profile until the next identity path is re-opened — an O-item (§9) |

---

## 8. Verification Strategy

**Locally verifiable (no vehicle, no Tesla API):**

1. Coordinator due-check: identity runs once, odometer runs when due, both skip when not.
2. Wake-free: module fetch URLs contain no wake path.
3. Candidate set excludes no-equivalent fields — FSD counters absent (AC1).
4. Source stamp: polled rows write `poll`, telemetry rows keep `telemetry` default (AC7).
5. Revocation: teardown clears poll state. A subsequent ingest produces no poll attempt (AC5).
6. Consentless ingest fails closed before the coordinator's precondition.
7. Metering: `data_requests` increments per REST call (AC8).
8. Enrolment round-trip: enrol a field, assert it enters the poll candidate set and gains a global
   seed (ties to SDD-011 §12.4).
9. Migration safety: 0019 passes `verify-schema` including the D1 statement-size gate.

**Needs external state (a real paired vehicle with REST access):**

10. First sync: identity fields populated from one `vehicle_config` call, never again over 8 days
    (AC3).
11. Weekly backstop: a vehicle with telemetry flowing receives the odometer poll inside its window.
12. Live revocation: revoke a member, check for zero further REST calls in the account activity log.

---

## 9. Open Items

| O-N | Item | Owner |
|-----|------|-------|
| O-1 | Tesla REST rate limits per device (R-10 limits still unretrieved): whether a fleet-wide weekly poll batch needs bounding at 1,000 vehicles. Polls fire spread across telemetry batches, which self-thins, but an ingest burst could coincide. | Build phase |
| O-2 | Whether the identity path re-opens after a firmware change (a new `Version` arrives over telemetry and contradicts the stored one). Today telemetry's `once` tier already carries `Version`, so the mismatch is visible — but no rule re-polls identity on mismatch. | Warren |
| O-3 | `car_special_type` and VIN/Model as REST reads: catalog rows for them do not exist yet. Enrolment (F12-R18) is the path once the catalog gains them. | Catalog refresh |

---

## 10. Related Documents

| Artifact | Relation |
|---|---|
| [FRS-010 v2.3](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md) | Requirements — FEATURE-14 (F14-R01..R10) and the consent clause at F14-R06 |
| [SDD-010](./SDD-010-afirmico-auto-telemetry-architecture-v1.md) | Transport, relay, ingest normalisation — this design plugs into its ingest path |
| [SDD-011](./SDD-011-afirmico-auto-config-scopes-v1.md) | Scope engine and the configurator table (§12.1 badge, §12.2 seeds) |
| `apps/afirmico-tesla/src/oauth.ts` | `refreshTokens()` — the token machinery every poll reuses (F14-R08) |
| `apps/afirmico-tesla/src/telemetry.ts` | `persistDatums()` — the normalisation path polled rows share (F14-R08) |
| `apps/afirmico-tesla/src/consent-policy.ts` | `CONSENTED_FIELDS` — the write-time filter the poll response intersects |
| `apps/afirmico-tesla/migrations/0001_create_tesla_schema.sql` | `vehicle_data_equivalent` column — the source of the transport badge (F14-R01) |