# Tesla data model — storage design

FRS-010 F08. Owner of this database is the `afirmico-tesla` Worker. The Oracle relay
never writes to it (SDD-010 invariant 3).

## The one idea that shapes everything

**The catalog holds every field Tesla can send; the collected subset is a flag.**

FRS-010 F03 requires the complete Fleet API surface to be stored up front so that
widening what we collect later is a configuration change, not a migration. Every field
in Tesla's `vehicle_data.proto` — 272 of them — lives in `tesla_field_catalog`, with
`collected` deciding whether it is actually gathered:

```sql
SELECT field_key, collection_tier FROM tesla_field_catalog WHERE collected = 1;
-- 14 rows. 258 rows remain catalogued and uncollected.
```

That is why the fact table is **narrow** (one row per field observation, typed value
columns) rather than one column per field: adding field 273 tomorrow inserts a catalog
row, and no `ALTER TABLE` ever runs.

## Sources, and which one wins

| Source | Role |
|--------|------|
| `vehicle_data.proto` (teslamotors/fleet-telemetry) | **Authoritative** for field identity: names, numbers, enum names, value enums, firmware gates |
| `fleet_streaming_fields.csv` (in-repo) | Human-facing metadata the proto lacks: category, type, description, REST equivalent |
| `alert_dictionary.csv` (in-repo) | The 18,436-entry alert catalog |
| developer.tesla.com endpoint pages | The complete endpoint registry |

The proto and the CSV disagree in one direction: the proto has **272** fields, the CSV
**239**. All 33 proto-only fields are catalogued (`source = 'proto'`), including fields
gated behind firmware 2026.32. Had we shipped the CSV alone, those fields would have
needed a migration the moment a member's car reported one.

## Collection tiers — the part that keeps the database small

Storing every collected field as an observation would write `CarType` once per push,
forever, for a value that never changes. Tiers fix that:

| Tier | Meaning | Stored in | Count |
|------|---------|-----------|-------|
| `event` | A reading that changes; the product itself | `tesla_telemetry_fact` | 3 |
| `on_change` | State where only transitions matter | `tesla_telemetry_fact` | 8 |
| `once` | Vehicle attribute, constant per hardware/firmware version | `tesla_vehicle_snapshot` | 3 |
| `never` | Catalogued, not collected | — | 258 |

The launch set (owner decision, 2026-10-02) is odometer + FSD kilometres as the product,
plus the safety/settings context that makes those numbers interpretable.

Two triggers enforce the tiers rather than trusting application code:

- `trg_tesla_fact_requires_collected_field` — a fact for a field whose `collected = 0` is
  rejected (`F03 AC5`). Without it, widening the Worker's field list without seeding the
  catalog would silently write data the platform cannot describe.
- `trg_tesla_snapshot_requires_once_field` — an `event` field can never be written to the
  snapshot table, so the two storage paths cannot drift into each other.

## Tables by feature

```
F03  tesla_field_catalog           272 fields, collected flag, tier, sensitivity
     tesla_field_enum_value        247 enum values across 43 enums
     tesla_field_enum_def          43 enum definitions, with value counts
     tesla_endpoint_catalog        107 endpoints, 8 families, enabled flag
     tesla_alert_catalog           18,436 rows keyed (signal_name, models)
     tesla_catalog_load            load ledger: source + sha256 + row counts

F01  tesla_member, tesla_vehicle, tesla_vehicle_snapshot(+_history),
     tesla_vehicle_key, tesla_consent, tesla_auth_session

F04  tesla_telemetry_config, tesla_telemetry_batch, tesla_telemetry_fact,
     tesla_state_change, tesla_signal_counter, tesla_billing_guard

F05  tesla_driver_profile, tesla_counter_reset

F06/ tesla_release, tesla_quote_request, tesla_release_access,
F07  tesla_download_token

F09/ tesla_admin_user, tesla_audit_event, tesla_erasure_log
F10
```

## Decisions worth knowing

**ULID text keys, not integers.** Row ids are ULIDs stored as `TEXT`:
lexicographically sortable by creation time, so `ORDER BY id` is chronological and no
extra index is needed. Generated in the Worker, not by SQLite, so the schema does not
depend on a SQLite version.

**ISO-8601 UTC text timestamps.** They sort correctly, survive a JSON round trip, and
stay legible in a D1 dump. Durations are also text (`'6 hours'`) because they are
display values passed to Tesla, not arithmetic operands.

**One raw-payload table, not two.** An earlier design had the relay POST to one table and
the Worker normalise into another, which duplicated every payload and left the raw copy
without an owner. There is now exactly one `tesla_telemetry_batch`: the body lives in R2,
the row carries the reference, checksum and processing state. `processed_at IS NULL` is
the work queue.

**Consent is append-only, and is not the session.** A grant records scopes, policy
version, purposes and timestamps; revocation sets `revoked_at` and inserts nothing over
it. `trg_tesla_consent_append_only` makes un-revoking impossible. A row in
`tesla_auth_session` is operational state, **not** the audit trail F01-R02 requires.

**`value_kind = 'invalid'` is a first-class outcome.** Tesla sends `Value{invalid: true}`
when a signal is unsupported or unavailable. That is a fact worth storing — it is how
"this vehicle does not support FSD reporting" becomes visible instead of being
indistinguishable from missing data. The check constraint allows exactly one populated
value column, or none when `value_kind = 'invalid'`.

**Billing breach is tracked, not inferred.** Exceeding Tesla's billing limit strips every
telemetry config and Tesla does not restore them (`F02-R13` / `R-07`), so
`tesla_billing_guard` records the observed limit, usage, projection and margin, with a
`remediation_state` so a breach is detected rather than noticed later.

## Regenerating the seeds

**All four migration files are committed**, including the 7.5 MB alert seed. That is deliberate: a
gitignored `0003` would be *silently skipped* by `wrangler d1 migrations apply`, leaving the alert
catalog empty in production with no error. The cost is 7.5 MB in the repository; the alternative is a
production database that is quietly missing 18,436 rows.

Regeneration is only needed when Tesla's published data changes. It requires the two source CSVs,
which live under `apps/EdgeGDE - Document DB/` and are **gitignored** — so a fresh clone cannot
regenerate them, it can only verify them. Keep a working copy of that directory somewhere for
catalog refreshes.

```bash
export TESLA_PROTO=/path/to/vehicle_data.proto    # from teslamotors/fleet-telemetry protos/
export TESLA_DOCS=/path/to/tesla-endpoint-docs    # saved developer.tesla.com endpoint pages

bun run catalog:fields       # proto + CSV      -> 0002
bun run catalog:alerts       # alert CSV        -> 0003
bun run catalog:endpoints    # endpoint docs    -> 0004
```

Output is deterministic — `SOURCE_DATE_EPOCH_ISO` pins the recorded load time, so re-running with
unchanged sources produces byte-identical SQL (verified). A regenerated seed that differs is a real
change, reviewable as a diff.

## Verifying

```bash
bun run verify:schema
```

Applies all four files to a throwaway SQLite database and asserts FRS-010's own acceptance criteria:
catalog counts, the 18,436/17,579 alert split, disabled families, the collection tiers, every guard
trigger, and idempotency by re-running the seeds against the same database. Exit code is the number
of failed checks, so CI can gate on it. Runs in CI on every PR touching `apps/afirmico-tesla/`.

## Applying

Migrations are **CI-only** (repo fleet policy: no `wrangler d1 migrations apply` from an agent pane).
`afirmico-tesla` is bound in `wrangler.json` as `D1_TESLA` and applied by the `tesla-schema` job in
`ci.yml`, which provisions the database if absent and applies pending migrations.

Two things to know before this reaches production:

1. **`0004` seeds 72 vehicle-command and 6 energy-command endpoints with `enabled = 0`.** They are
   catalogued, not callable. Enabling a command family requires an explicit decision, not a flag flip
   in passing — F02-R09 requests neither `vehicle_cmds` nor `energy_cmds`.
2. **`0001` is a `CREATE TABLE IF NOT EXISTS` migration on a fresh database.** It is not idempotent
   across schema changes: a later column addition must be a new numbered migration, never an edit to
   `0001`.

