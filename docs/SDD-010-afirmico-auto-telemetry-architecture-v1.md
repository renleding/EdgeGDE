# System Design Document (SDD): AFIRMICO Auto — Tesla Fleet Telemetry Platform

**Document ID:** SDD-010  \
**Version:** 1.8  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-10-02  \
**FRS Reference:** [FRS-010](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md)  \
**Source:** Requirements interview + architecture review (owner decisions 2026-09-29)

---

## 1. Scope

Internal architecture for FRS-010: how member consent, Tesla Fleet Telemetry ingestion, driver-profile
derivation, insurer data release, and the admin dashboard are built; where each component lives; and how
data flows between them.

**This SDD supersedes the polling transport.** FRS-010 §3.6 chose polling on the basis that it avoided a
mTLS telemetry host entirely. The owner has since selected Fleet Telemetry as the sole transport and a
minimal **kms + FSD-kms** field set with a 6-hour refresh. Section 1.1 records what that changes.

**Revision note (rev 1.8, 2026-10-02).** Wording correction; no design change. The `vehicle-command`
component on the relay is a **configuration signer only** (F02-R11, amended). It signs the
`fleet_telemetry_config` JWS with the application private key; **no vehicle command is ever sent to a member
vehicle**, and the `vehicle_command` endpoint family is seeded disabled (72 endpoints) and asserted so in
CI. Earlier revisions labelled this component only by its upstream repository name, which read as though
AFIRMICO operated a vehicle-command gateway. See §10.3 for why the signer is required even when no command
is ever issued.

### 1.1 What the telemetry pivot changes

| Area | Polling design (superseded) | Telemetry design (this SDD) |
|------|------------------------------|------------------------------|
| Transport | Scheduled `GET vehicle_data` | Vehicles push to a self-hosted `fleet-telemetry` server |
| Host requirement | None — Worker-only | One long-lived process terminating client-cert mTLS on :443 (cannot be a Worker) |
| Pairing | Not strictly required for register | **Required** — virtual key must be paired per vehicle |
| Vehicle wake | Deliberate wake per poll | No wakes; vehicle pushes when awake |
| FSD usage | **Blocked** (R-02) | **Resolved** — `SelfDrivingMilesSinceReset` is telemetry-only |
| Fields | `vehicle_data` groups (~120) | Explicit field set — **6 fields** |
| Billing risk | Billing limit removes configs? No configs exist | **A breach removes configs and Tesla does not restore them** |
| Firmware floor | `vehicle_data` broadly available | 2023.20.6+; FSD fields need 2025.44.25.5+ **and HW4** |

**Cost consequence (measured, not estimated):** the field set below produces ~525 signals/vehicle/month
→ **$0.0035/vehicle/month → $5.25/month for a 1,500-vehicle fleet**, against a $10/month account credit.
Tesla API cost is fully absorbed by the credit; total system cost is the infrastructure line ($10.53/mo).

Rejected against this: the same platform collecting high-frequency behaviour fields (`LateralAcceleration`,
`LongitudinalAcceleration`, `BrakePedalPos`) at 60 s cost **$207/month** — 39× more, for data no MVP
consumer needs. Field interval selection, not transport selection, is the cost lever.

---

## 2. Component Boundaries

```text
┌─ TIER 1 · Cloudflare (stateless, scale-to-zero, zero always-on cost) ──────────┐
│                                                                               │
│  Worker  afirmico-tesla     (NEW dedicated worker — not the calculator app)   │
│    /                                    SPA: splash + member portal           │
│    /.well-known/appspecific/            Tesla public key (MIME per F02-R01)   │
│      com.tesla.3p.public-key.pem                                              │
│    /auth/callback                       Tesla OAuth code exchange            │
│    /admin/*                             operator dashboard (role-gated)       │
│    /api/telemetry/ingest                relay → D1/R2 (shared-secret auth)    │
│    /api/insurer/package/{id}            time-limited CSV download             │
│                                                                               │
│  D1  tesla_* tables        F08 schema (catalog + narrow fact + raw ref)       │
│  R2  raw payloads          one object per vehicle per ingest batch            │
│  Queues  derivation        profile derivation fan-out                         │
│  DO  RATE_LIMITER, AUDIT_LEDGER   (already deployed on this worker)           │
│  Cron  0 */6 * * *         derive profiles, refresh aggregates, signal count  │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ HTTPS POST (shared secret)
                                    │ batched JSONL, 5-minute flush
                                    │
┌─ TIER 2 · Telemetry relay (single small VPS, AU) ────────────────────────────┐
│                                                                               │
│  fleet-telemetry (Go, teslamotors reference impl)                             │
│    • terminates vehicle client-cert mTLS on :443                              │
│    • output: JSONL via the `logger` dispatcher                                │
│    • stateless: holds no database, does no derivation                         │
│                                                                               │
│  tesla-http-proxy (from teslamotors/vehicle-command)                          │
│    • CONFIG SIGNER ONLY — signs the fleet_telemetry_config JWS                │
│    • NO vehicle commands sent (72 command endpoints disabled)                 │
│    • one outbound IP → Tesla partner allowlist                                │
│                                                                               │
│  Both share ONE private key. Both restartable from repo + secret.             │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ vehicle pushes when awake
                                    │
                        ┌───────────┴───────────┐
                        │  Member Tesla vehicle │
                        │  (virtual key paired) │
                        └───────────────────────┘
```

**Boundary rule.** The relay is a *span port*: it terminates mTLS, converts protobuf to JSON, and forwards.
It owns no business logic, no schema, and no persistence. Any enrichment, validation, or derivation happens
in Tier 1. This keeps the relay replaceable in minutes and keeps a single writer for the D1 schema.

**Boundary rule.** All Tesla API *calls* (config create, token exchange, fleet_status) originate in Tier 1
and go out through the proxy on Tier 2. The relay never initiates a Tesla call of its own. The proxy is
hosted **solely as a configuration signer**: it signs the `fleet_telemetry_config` JWS with the
application private key (F02-R11). **No vehicle command is ever sent to a member vehicle** — the
`vehicle_command` endpoint family is seeded disabled and CI fails if it is enabled.

**Tier 1 is a NEW, dedicated worker (owner decision 2026-10-02).** `auto.afirmi.co` is currently bound as a
Workers **Custom Domain** — not a route — to `aged-cherry-8781`, a catch-all splash/calculator worker with
**zero bindings** that answers every path with the same HTML document. It cannot serve Tier 1 (no D1, no R2)
and must not be repurposed. Tier 1 is therefore built as a new worker, `afirmico-tesla`, which **owns the
entire `auto.afirmi.co` hostname** via its own Custom Domain. That also removes the route-separation problem
in F02-R01 by construction: the key path and the SPA are served by the same worker, with the `/.well-known`
handler registered ahead of the SPA fallback (the repo already does this for `/.well-known/mcp.json`, see
`apps/edge-runtime/src/index.ts`). Reusing `edgegde-calculator` is explicitly **rejected**: it is the
calculator app, and its D1 bindings point at document-intelligence databases.

---

## 3. Data Flow

### 3.1 FEATURE-02 — Registration and configuration (one-time, per vehicle)

```text
1.  Tier1 → proxy   POST /api/1/partner_accounts   (partner token, domain=auto.afirmi.co)
                    → requires public key already hosted at /.well-known (F02-R01)
2.  Member          https://tesla.com/_ak/auto.afirmi.co  → adds virtual key via Tesla app
                    → key-pairing is user-in-the-loop; cannot be automated
3.  Tier1 → proxy   POST /api/1/vehicles/fleet_telemetry_config  (JWS signed by private key)
                    → skipped_vehicles returns missing_key | unsupported_hardware |
                      unsupported_firmware | max_configs  → recorded per VIN
4.  Vehicle         adopts config on next backend connection
                    → GET .../fleet_telemetry_config until synced = true
```

`max_configs`: a vehicle accepts **3 fleet telemetry configurations** (docs elsewhere say five
third-party apps). Exceeding it returns `limit_reached = true`. This is a hard per-vehicle ceiling that
AFIRMICO shares with any other app the owner runs (e.g. TeslaFi, Home Assistant). It must be surfaced as a
distinct failure, not a generic error.

### 3.2 FEATURE-04 — Telemetry ingest

```text
Vehicle  ──mTLS──▶  fleet-telemetry (:443)
                       │  protobuf Payload {data[], created_at, vin, is_resend}
                       │  rate-limits per VIN, acks after dispatch
                       ▼
                     logger dispatcher → JSONL
                       │  buffered, flushed every 5 min OR 1 MB
                       ▼
Tier1    POST /api/telemetry/ingest   (shared secret)
          1. validate batch shape + VIN against enrolled set
          2. write raw JSONL blob → R2   key: raw/YYYY/MM/DD/{run_id}-{seq}.jsonl
          3. normalise → narrow fact rows (F08-R01) into D1
          4. increment tesla_signal_counter per VIN per day   (F04-N03 cost metric)
          5. upsert tesla_vehicle_connection state
```

**Idempotency.** Each batch carries a relay-generated `batch_id`; re-delivery is a no-op (F04-N05).
**Fault isolation.** A malformed record is quarantined to R2 and skipped, never failing the batch (F04-R11).
**`is_resend`.** Tesla sets this on payloads re-sent after a reconnect; rows are deduplicated on
`(vin, field_key, created_at)`.

### 3.3 FEATURE-05 — Profile derivation

```text
D1 narrow facts ──▶ derivation (deterministic, versioned)
                      │
                      │  distance      = Δodometer over window
                      │  fsd_kms       = ΔSelfDrivingMilesSinceReset over window
                      │  fsd_pct       = fsd_kms / ΔMilesSinceReset
                      │  charging      = ΔBatteryLevel, charging sessions
                      │  home_charging = LocatedAtHome co-occurrence
                      │  confidence    = f(snapshot count, coverage, completeness)
                      ▼
                    tesla_driver_profile (derivation_version, snapshot range)
```

**Critical semantics — the FSD counters reset.** `MilesSinceReset` and `SelfDrivingMilesSinceReset` reset on
software update, computer replacement, or factory reset. Consequences the derivation MUST handle:

- A **decrease** in either counter is a reset, not negative travel. The delta is discarded and the window
  restarts from the post-reset value.
- `fsd_pct` is a **since-reset ratio**, never lifetime. It MUST be labelled as such in every output
  (F05-R13) — an underwriter reading "42% FSD" without the reset caveat would misprice.
- `SelfDrivingMilesSinceReset` **requires `minimum_delta >= 1`** and is HW4 + firmware 2025.44.25.5+ only.
  Vehicles that cannot report it get `fsd_available = false`, not a zero (F05-R11).

### 3.4 FEATURE-07 — Insurer release

```text
Admin ──▶ quote request ──▶ consent check (live, unrevoked)
                              │
                              ├─ no consent → BLOCKED (F07-R02)
                              ▼
                            generate CSV → R2 (private, unguessable key)
                              │
                              ▼
                            signed download URL, time-limited, single-recipient
                              │
                              ▼
                            tesla_data_release audit row (consent version, fields, recipient, ts)
```

The release path is the only code path permitted to read member PII into an outbound artifact, and it
writes an audit row on every invocation.

### 3.5 FEATURE-10 — Revocation

```text
Member revokes
  ├─ policy held?  YES → stop collection (DELETE fleet_telemetry_config), retain until expiry, then delete
  └─                NO  → stop collection (DELETE fleet_telemetry_config), delete immediately
                             │
                             ▼
                    purge D1 rows + R2 raw objects + derived profiles
                    write deletion audit (survives the deletion)
                    group aggregates retained (no PII)
```

**Collection stops at the source.** For a telemetry platform, "stop collecting" means the vehicle must be
de-configured — `DELETE /api/1/vehicles/{vin}/fleet_telemetry_config`. Merely ignoring inbound data would
leave the vehicle streaming, which is both a privacy failure and a continuing Tesla API charge.

---

## 4. Data Structures

### 4.1 Telemetry configuration (the cost-critical artifact)

```json
{
  "vins": ["<vin>"],
  "config": {
    "hostname": "telemetry.afirmi.co",
    "port": 443,
    "ca": "<full LE certificate chain — contents, not a path>",
    "fields": {
      "Odometer":                   { "interval_seconds": 21600, "minimum_delta": 1 },
      "MilesSinceReset":            { "interval_seconds": 21600 },
      "SelfDrivingMilesSinceReset": { "interval_seconds": 21600, "minimum_delta": 1 },
      "BatteryLevel":               { "interval_seconds": 21600, "minimum_delta": 1 },
      "LocatedAtHome":              { "interval_seconds": 21600 },
      "LocatedAtWork":              { "interval_seconds": 21600 }
    }
  }
}
```

**Why this is cheap.** Signals bill on *change*, gated by `interval_seconds` per field, and only while the
vehicle is awake. With a 6-hour interval a field can emit at most 4 times a day, and emits nothing while the
vehicle sleeps. Measured: ~17.5 signals/vehicle/day → 525/month → $0.0035/vehicle/month.

**Delta gate.** `SelfDrivingMilesSinceReset` *requires* `minimum_delta >= 1`, so it only emits when at least
one FSD mile has accrued since its last send. It is already maximally throttled and cannot be throttled
further — this is a Tesla-imposed floor, and it also means the FSD field costs almost nothing.

**Open verification:** whether `interval_seconds` accepts a 6-hour value, or caps lower. The docs show the
1–60 s range and a 10-minute example and do not state a maximum. If 21600 is rejected, fall back to 3600
(1 h), which costs ~$6.60/mo fleet — still inside the credit. **Verify against a live vehicle before
committing the config** (see §7).

### 4.2 D1 tables

**The F08 schema is implemented** in `apps/afirmico-tesla/migrations/` and that migration is
authoritative for table and column names. Verified by `bun run verify:schema`
(28 tables, 4 guard triggers, 32 acceptance checks). This section records only the reasoning behind
the parts that were decided here; it is not a second copy of the DDL.

```text
0001_create_tesla_schema.sql       28 tables, 4 triggers, indexes, constraints
0002_seed_tesla_catalog.sql        272 fields + 247 enum values + load ledger
0003_seed_tesla_alerts.sql         18,436 alerts  (generated; gitignored)
0004_seed_tesla_endpoints.sql      107 endpoints across 8 families
```

**Four deliberate divergences from the pre-implementation sketch. Each was wrong in a way worth
recording, because the sketch was plausible and the correction is not obvious.**

| Sketch | Implemented | Why |
|---|---|---|
| `tesla_alert_dictionary` keyed on `signal_name` | `tesla_alert_catalog` keyed on `(signal_name, models)` | F03-R04a. 853 signal names carry model-specific variants (17,579 distinct names across 18,436 rows). Keying on the name alone either drops variants or picks one arbitrarily. |
| `tesla_energy_site` + energy snapshot | **withdrawn** | F02-R09 seeds the app with `energy_device_data` and `energy_cmds` **not** requested, so Powerwall data cannot be collected. Creating empty tables for data the integration cannot obtain implies a capability that does not exist. F08-R07 is marked deferred. |
| `tesla_telemetry_config.vin` as PRIMARY KEY | `config_id` surrogate key, `vin` indexed | A vehicle accepts **3** fleet telemetry configs (U5). `vin` as the primary key makes the second config unrepresentable, and that constraint only surfaces in production when a member adds a second app. |
| `tesla_vehicle_connection`, `tesla_virtual_key` | `tesla_state_change`, `tesla_vehicle_key` | Connection state arrives as telemetry transitions, so it is a state-change row rather than a polled snapshot; `tesla_vehicle_connection` would have needed its own sampling loop for data telemetry already provides. |

`tesla_signal_counter` is implemented as sketched (per-VIN per-day signal counts with an estimated
cost), plus `tesla_billing_guard` for the limit/margin tracking that R-07 needs — a breach is
destructive (it strips every telemetry config and Tesla does not restore them), so it is recorded
rather than inferred.

Two additions not in the sketch, both enforcing correctness in the database instead of in the Worker:

- `trg_tesla_fact_requires_collected_field` — rejects a fact row for a field whose catalog
  `collected = 0`. Without it, shipping a new field in the Worker before seeding the catalog writes
  data the platform cannot describe, and nothing reports the drift.
- `trg_tesla_snapshot_requires_once_field` — keeps `once`-tier attributes out of the fact table and
  event fields out of the snapshot, so the two storage paths cannot diverge.

**Storage economics of the tier split.** A 6-hourly push of the launch set on 1,500 vehicles writes
`event`/`on_change` rows continuously, but `CarType`, `Version` and `EfficiencyPackage` are written
**once per vehicle** rather than once per push (~4,380 rows/vehicle/year avoided). That is the
difference between ~6.6M and ~35M rows/year at fleet scale, on a database whose free tier is 5 GB.

`tesla_signal_counter` is what makes F04-N03 ("cost is a first-class run metric") achievable. Without it the
platform cannot see its own spend until Tesla's invoice arrives.

### 4.3 Narrow fact rows

Reuses the F08 shape; the collected subset is 6 fields:

```text
(vin, collected_at, field_key, value_real, value_int, value_text, value_bool, source_batch_id)
```

`field_key` references `tesla_field_catalog` — which carries **all 239 fields** with `collected = 0` for the
233 not in use, per F03-R07. Expanding the field set later is a config change, not a migration.

---

## 5. File Structure

```text
apps/afirmico-tesla/                        ← NEW worker, dedicated to Tesla (owner decision 2026-10-02)
  public/
    .well-known/appspecific/
      com.tesla.3p.public-key.pem            committed PUBLIC key (MIME per F02-R01)
  migrations/
    00NN_create_tesla_catalog.sql            F03: 239 + 18,436 + endpoint catalog
    00NN_create_tesla_telemetry.sql          config, connection, signal counter, virtual key
    00NN_create_tesla_facts.sql              narrow fact + raw ref
    00NN_create_tesla_profiles.sql           derived profile + derivation version
    00NN_create_tesla_release.sql            release audit + download tokens
  src/
    tesla/
      auth.ts                                token lifecycle (client_credentials + PKCE)
      register.ts                            partner registration + public_key verify
      configure.ts                           fleet_telemetry_config create/delete/get
      ingest.ts                              /api/telemetry/ingest → R2 + D1
      derive.ts                              deterministic profile derivation
      release.ts                             packaged CSV + signed download URLs
      revoke.ts                              de-configure + purge
    admin/                                   dashboard + map
  wrangler.json                              name=afirmico-tesla; D1_TESLA, R2_TESLA, cron,
                                             routes/custom_domain auto.afirmi.co
```

**Why a new top-level app, not a folder in `apps/edge-runtime/`.** The hostname split is the reason: one
hostname can only be served by one worker, and `auto.afirmi.co` must serve the Tesla key before the SPA. A
separate app also keeps the calculator's D1 databases untouched and gives the Tesla integration its own
`name` in `wrangler.json`, its own deploy target, and its own D1/R2 bindings — matching F08-R09.

```text
infra/telemetry-relay/                      ← NEW, separate deploy unit
  README.md                                 host, ports, mTLS, cert renewal
  server_config.json                        fleet-telemetry config (JSONL + connectivity)
  relay.ts | relay.py                       batch + POST to /api/telemetry/ingest
  check_server_cert.sh                      Tesla's validator (mTLS pre-flight)
  deploy.md                                 runbook: fresh host → streaming in prod
```

The relay is deliberately outside `apps/afirmico-tesla/` because it deploys to a different target and must
be replaceable without touching the Worker.

---

## 6. Invariants

1. **The private key never leaves the enterprise boundary.** Not in the repo, not in D1, not in logs, not
   in the relay's config file — environment variable or secrets store only. It signs both telemetry config
   and vehicle commands; its compromise is total.
2. **The public key is frozen.** Once registration succeeds, the key pair MUST NOT rotate. Tesla requires
   the registered public key to *remain* hosted; rotation invalidates the key on every paired vehicle.
   Rotation is a re-pairing migration, not a routine operation. (Tesla explicitly recommends the
   configuration-signing key be held offline and in an HSM.)
3. **One writer for the Tesla schema.** Only Tier 1 writes D1. The relay never writes a database.
4. **Derivation is deterministic and versioned.** Identical inputs → byte-identical output; every profile
   records its `derivation_version` and source snapshot range.
5. **No fabricated values.** An absent field yields `unavailable` and reduced confidence, never a
   substituted estimate (F05-R11).
6. **Collection stops at the source on revocation** — de-configure the vehicle, don't merely ignore traffic.
7. **Every outbound release carries a consent version and writes an audit row.**
8. **Raw payloads are replayable for the retention window** — a parsing bug is fixable without re-asking
   members to stream.

---

## 7. Failure Modes

| Failure | Detection | Handling |
|---------|-----------|----------|
| **Billing limit breached** | Tesla 80%/100% emails; `tesla_signal_counter` trend | ⚠️ **Configs are removed and NOT restored.** Requires: limit set well above projected spend, 80% alert wired, and a re-apply runbook (F02-N04). Highest-severity failure in the system. |
| `interval_seconds` rejected | config create returns an error | Fall back to 3600; record which interval is live per VIN |
| `missing_key` | `skipped_vehicles` on config create | Surface in portal as "pair your vehicle"; re-drive pairing |
| `max_configs` / `limit_reached` | config get | Distinct error — owner must free a slot in another app; cannot be resolved by AFIRMICO |
| `unsupported_firmware` | `skipped_vehicles` | Hold vehicle; re-attempt on next `fleet_status` firmware check |
| Relay host down | ingest heartbeat gap > 2 × flush interval | Alert operator. Vehicles reconnect automatically; **no data is lost from the vehicle's perspective** but unsent batches are. |
| Certificate expiry | `check_server_cert.sh`, cert-expiry monitor | Vehicle mTLS fails silently at expiry — automate renewal + alert (F02-N05) |
| Counter reset (FSD/mileage) | negative delta in derivation | Discard window, restart from post-reset value, flag discontinuity |
| Token refresh failure | auth error on scheduled run | Defer the run and alert; never block other vehicles (F02-R05) |
| Partial batch | malformed record | Quarantine to R2, skip, count; never fail the batch |

---

## 8. Verification Strategy

1. **Public key pre-flight** — `GET /.well-known/appspecific/com.tesla.3p.public-key.pem` returns
   the PEM (MIME per F02-R01) with byte length matching the committed file, and **openssl parses it**.
   Today the domain returns SPA HTML on that path (R-01 blocker).
2. **mTLS pre-flight** — Tesla's `check_server_cert.sh` passes against the relay host before any config
   is pushed. Note that fleet-telemetry rejects any client certificate whose issuer is not a Tesla CA
   (§10.5), so this validates **our** server certificate chain only — it does not exercise vehicle auth.
3. **Registration** — `POST /partner_accounts` succeeds; `GET /partner_accounts/public_key?domain=`
   returns the exact key.
4. **Field-set acceptance** — config create returns no `skipped_vehicles` for a supported test vehicle, and
   `synced = true` on poll. **This is where the 6-hour interval question (O-1) is settled empirically.**
   Requires a **real paired vehicle** — a synthetic client cannot stream (§10.5).
5. **Signal economy** — after 7 days on a real vehicle, `tesla_signal_counter` is within ±20% of the
   modelled 525/month/vehicle. A large overshoot means the interval is not being honoured.
5a. **Ingest contract** — synthetic JSONL posted directly to `/api/telemetry/ingest` produces correct D1
   rows, R2 objects, and signal counts. Testable **without** a vehicle; run this before step 4 so the
   pipeline is proven before hardware is involved.
6. **FSD derivation** — a profile over a known window matches hand-computed
   `ΔSelfDrivingMilesSinceReset / ΔMilesSinceReset`, and a forced reset marker produces a discarded window
   rather than a negative figure.
7. **Determinism** — two derivation runs over a fixed snapshot set produce byte-identical JSON.
8. **Revocation** — after revoke, `GET fleet_telemetry_config` confirms the config is gone and no further
   batches arrive; D1 rows and R2 objects for that VIN are absent.
9. **Release control** — an expired download URL is refused; the attempt is logged; no PII appears in the
   email body.

---

## 9. Open Items

| ID | Item | Owner |
|----|------|-------|
| O-1 | **Does `interval_seconds` accept 21600 (6 h)?** Verify on a live vehicle. Fallback 3600 modelled. | Build phase |
| O-2 | **Relay host choice** — **resolved and PROVISIONED 2026-10-02.** Oracle Cloud `ap-sydney-1`; instance `relay-afirmico-tesla`, `VM.Standard.A1.Flex` **2 OCPU / 8 GB** arm64, RUNNING at `158.180.7.252` (see §10.8). Build sequence: §10.8, of which the host half is done. | Warren |
| O-3 | **Tesla developer app creation** (R-01) — gates registration; nothing streams until it exists. Register **after** the relay is up (§10.8 step 9). | Warren |
| O-4 | **Tesla outbound-IP requirement** — confirm whether the partner allowlist requires a static IP, which would constrain the host choice. Partly answered by §10.8 step 4 (reserved public IP). | Build phase |
| O-5 | **Consent wording** (R-06) — must disclose data leaves the vehicle to a US processor (Tesla) and to insurers (APP 8). | Warren |
| O-6 | **D1_TESLA binding decision** — extend `D1_AFIRMICO` vs provision a dedicated database per F08-R09. | Build phase |
| O-7 | **PAYG upgrade completion** — **RESOLVED 2026-10-02.** Tenancy reports `payment-model: PAYG` (`start-date 2026-09-30`), so idle reclamation is removed and the paid Arm allowance applies. Previously gated §10.8 step 0; that gate is now satisfied. | Oracle — **closed** |
| O-8 | **Admin access path** — whether OCI Bastion can target an instance in a *public* subnet, or whether Run Command / a narrowed-CIDR `:22` is the answer (§10.8 step 5). | Build phase |
| O-9 | **Public-key `Content-Type` is contradictory across the specs.** FRS F02-R01 requires `application/x-pem-file`; this SDD previously said `text/plain`. The correct value must be settled empirically against Tesla's onboarding validator, then both documents aligned. Left unresolved rather than guessed. | Build phase |
| O-10 | **Worker name + hostname ownership.** Worker name `afirmico-tesla` is provisional. Moving `auto.afirmi.co` from the `aged-cherry-8781` Custom Domain to the new worker changes what the public splash URL serves — confirm no member-facing dependency on the current splash content before the cutover (see §5). | Warren |

---

## 10. Relay Host Specification (measured)

Sizing is **measured, not estimated**. Both Tesla images were run locally and load-tested
(2026-09-29, `tesla/fleet-telemetry:latest`, `tesla/vehicle-command:latest`).

### 10.1 Measured footprint

| Metric | fleet-telemetry | vehicle-command proxy |
|--------|----------------|----------------------|
| Image size | 90.2 MB | 119 MB |
| RSS, idle | 12.0 MiB | 16.8 MiB |
| RSS, **1,500 authenticated sessions** | **26.3 MiB peak** | n/a (not connection-scale) |
| Marginal per session | **4.18 KiB** | n/a |
| CPU, idle | 0.01% | 0.0% |
| CPU, cold-start burst | 1 vCPU absorbed 1,500 mTLS handshakes + WS upgrades in **3.5 s** | — |
| Writable layer | 15.8 kB | — |

Method: 1,500 concurrent sockets each completing a mutual-TLS handshake and a WebSocket upgrade
(`HTTP/1.1 101 Switching Protocols` ×1,500), RSS sampled every 2.5 s. The first attempt without
client certificates measured only 13.5 MiB and was **discarded as a lower bound** — the server was
rejecting at the handshake, so it was not a valid proxy for real load.

### 10.2 Minimum specification

| Resource | Minimum | Recommended | Why |
|----------|---------|-------------|-----|
| **vCPU** | 1 shared | 2 shared | Steady-state load is negligible. The only CPU spike is the cold-start thundering herd — up to ~1,500 vehicles waking after a fleet-wide config push, or when many vehicles start their day at once. Measured: 1 vCPU absorbed 1,500 handshakes in 3.5 s. |
| **RAM** | 512 MB | **1 GB** | Measured working set is ~45 MiB for both daemons (26 MiB + 17 MiB). The rest is OS, container runtime, and page cache. 512 MB is workable; 1 GB removes any reason to think about it. |
| **Disk** | 10 GB SSD | 20 GB SSD | OS ~3 GB + images 210 MB + logs. Traffic volume is trivial (~525 signals/vehicle/month). **Log rotation is mandatory** — an unbounded stdout stream is the realistic way to fill this disk. |
| **Arch** | x86_64 **or** arm64 | arm64 | Both are static Go binaries; both images are multi-arch. arm64 is typically cheaper on AU providers. |
| **Network** | Public IPv4, unrestricted inbound **:443** | + static/public IP | Vehicles connect **inbound** to this host. It cannot sit behind a NAT or a shared app host. |
| **Access** | root or container control | + no shell in app image | The app image is `scratch`-based (**no `sh`, no shell**). Debugging is `docker logs` / `docker exec` from the host only — there is no shell inside to attack. |
| **Ports** | 443 (telemetry only), 22 restricted | 22 key-only, geo/allowlist-limited | 443 must be open to the internet — vehicles dial *in*. 22 must not be. The config-signing proxy binds **loopback only** and takes no public port. |

### 10.3 Operating system

**Ubuntu 24.04 LTS.** Debian 12 or RHEL 9 are acceptable equivalents. Rationale:

- Both components ship as **Docker images** (Tesla's supported distribution path), so the OS matters
  mainly for the container runtime and long-term patch support.
- Ubuntu 24.04 LTS is supported to 2029 and has the widest provider image availability in AU regions.
- The app is a static Go binary — no interpreter, no package-manager dependencies at runtime. There is
  no language-runtime version risk to manage.

**Port binding.** The telemetry server binds :443, a privileged port. (The config-signing proxy binds
loopback only — it takes no public port, see below.)
Run with `--cap-add=NET_BIND_SERVICE` or drop to a high port and redirect with `iptables`/a reverse proxy.
Do not run either as `--privileged`.

**The proxy must NOT be internet-facing.** Started with `-host 0.0.0.0`, it warns verbatim:

> *Do not listen on a network interface without adding client authentication. Unauthorized clients may
> be used to create excessive traffic from your IP address to Tesla's servers, which Tesla may respond
> to by rate limiting or blocking your connections.*

It is only ever called by Tier 1, from the same host. Bind it to **`127.0.0.1`**. The only publicly
exposed process is fleet-telemetry on :443, and it enforces `RequireAndVerifyClientCert`.

**Why the signer exists when no command is ever sent.** The component is named after the repository it
ships in, not after the only job we give it. `tesla-http-proxy` does two separable things: it signs and
forwards **vehicle commands**, and it signs the **`fleet_telemetry_config` JWS**. AFIRMICO uses the second
only — the command role is unused and no command reaches a vehicle (F02-R11). It is still required,
because Tesla's endpoint contract states the recommended path for `fleet_telemetry_config` is through this
proxy, and calling `fleet_telemetry_config_jws` directly requires a **Schnorr signature over NIST P-256
with SHA-256** — which Workers WebCrypto cannot produce, so a signer would run on the relay regardless.
The relay is where it belongs: the private key lives there, and its outbound IP is stable for the Tesla
partner allowlist.

### 10.4 Configuration deltas from the reference defaults

| Setting | Value | Note |
|---------|-------|------|
| `tls.server_cert` / `tls.server_key` | Let's Encrypt cert for `telemetry.afirmi.co` | Must be the **full chain**; vehicles verify it |
| `tls.ca_file` | **must be unset in production** | The binary already embeds Tesla's production vehicle CA. Setting `ca_file` *appends* a CA to the trust pool — a needless widening of trust. Use it only in test. |
| `records.V` | `["logger"]` | JSONL to stdout; our wrapper batches and forwards |
| `records.alerts` / `records.errors` / `records.connectivity` | `["logger"]` | Connectivity records are how we distinguish "vehicle asleep" from "vehicle broken" |
| `transmit_decoded_records` | `true` | JSON instead of protobuf — avoids a protobuf dependency in the relay wrapper |
| `namespace` | `tesla` | Prefix only; no broker in use |
| `log_level` | `warn` in production, `info` while commissioning | Info-level logging wrote ~1.5 MB for 1,500 handshake events |
| Kubernetes / Kafka / Kinesis / Redis | **not used** | Reachable at 1,500 vehicles with the `logger` dispatcher alone |

### 10.5 Testing constraint (discovered during measurement)

fleet-telemetry authenticates vehicles by deriving an identity from the **client certificate's issuer
and Tesla OID** (`messages/identity.go`), then rejects anything else as `unauthorized certificate`.
A synthetic client certificate therefore **cannot** complete a session, even when it passes mTLS:

```text
level=error msg=extract_sender_id_err
  error="create_identity issuer: vehicle-sim, common_name: vehicle-sim,
         err: unauthorized certificate"
```

Consequences for the verification plan (§8):

- **Handshake and socket behaviour can be tested locally** — this is how §10.1 was measured.
- **Vehicle record ingestion cannot.** End-to-end streaming verification requires a **real paired
  vehicle**, so §8 item 4 and item 5 must be scheduled against one.
- The **relay's forward path is independently testable** — its contract is JSONL, so synthetic batches
  can be posted straight to `/api/telemetry/ingest`. This is a direct benefit of the span-port
  boundary: the ingest contract does not depend on the vehicle.

### 10.6 Provider requirements (for host selection)

Any provider is fine provided it offers, in an **AU region**: public IPv4, unrestricted inbound :443, a
full root or container-capable host (**not** a shared/managed application host), ≥512 MB RAM, ≥10 GB
disk, and ideally a static egress IP (pending O-4). A ~$5–7/month instance is materially more than
enough — the measured working set is ~45 MiB.


### 10.7 Candidate host evaluation — Oracle Cloud Always Free

**Verdict: suitable — with the account converted to Pay As You Go.** Hardware far exceeds requirement
and the platform is free within Always Free limits. Two things make the Pay As You Go conversion
load-bearing rather than optional: **the Arm shape may be unobtainable on the free tier at all** (see
Constraint 1), and **idle reclamation applies to Always Free tenancies only** (see Constraint 2).
Upgrading is **recommended** because Oracle documents it as the route to capacity, because paid
tenancies escape the Arm allowance reduction, and because it removes idle reclamation entirely.

**Upgrade status — ACTIVE, verified 2026-10-02 (rev 1.7).** The tenancy now reports
`payment-model: PAYG` with `start-date: 2026-09-30T...Z`. **Every benefit above is now in force**:
idle reclamation does not apply, the paid Arm allowance governs, and the documented route to capacity is
open. The earlier revision-1.6 text — *"the tenancy still reports `FREE_TRIAL` … therefore not yet
active … this gates provisioning"* — described the state before completion and is **superseded**; the
step-0 gate in §10.8 is consequently satisfied rather than standing. Capacity, re-read live at
provisioning time: **250 A1 cores / 1,666 GB free in `AP-SYDNEY-1-AD-1`** (0 used). The `41 cores /
277 GB` figure recorded in rev 1.6 was a narrower read and is superseded by this one.

Hardware is far beyond requirement. Both Tesla images publish **arm64** manifests (verified via
`docker manifest inspect`) and the arm64 `fleet-telemetry` binary was executed to confirm it runs on
`linux/arm64`. Oracle's Always Free image list includes Ubuntu, so §10.3 is satisfied.

| OCI Always Free shape | Spec | Assessment |
|----------------------|------|------------|
| `VM.Standard.A1.Flex` (Arm/Ampere) | **2 OCPU / 12 GB** on Always Free (halved from 4/24 on 2026-06-15; **paid tenancies keep 4/24**) | Exceeds the 1 vCPU / 512 MB–1 GB requirement many times over. **1 OCPU / 2 GB is ample.** Allocation size is right-sizing only — it has no bearing on reclamation, which PAYG removes. |
| `VM.Standard.E2.1.Micro` (AMD) | 1/8 OCPU / 1 GB / 50 Mbps, fixed quota | Technically sufficient. Non-flex quota (no hourly budget to exhaust). Thin CPU. Also freed from idle reclamation by PAYG, which applies to the tenancy, not the shape. |

#### Constraint 1: the Arm shape may be unobtainable

Oracle's Always Free documentation states, verbatim:

> If you receive an "out of host capacity" error when trying to create a Compute instance, this
> indicates a temporary lack of Always Free shapes in your home region. Try creating the instance in
> a different availability domain, or wait a while, then try to create the instance again. You can
> also choose to upgrade your account to Pay as You Go or another Paid account type, which gives you
> access to more types of Compute resources. Remember that Oracle doesn't charge for Always Free
> resources after you upgrade, and will only charge you for resource usage above the Always Free
> limits.

So **Pay As You Go is the documented route to obtaining capacity**, not merely an optimisation.
Sydney is a busy region and A1 capacity is in demand; provisioning on the free tier may simply fail
with `Out of host capacity`. Oracle's troubleshooting guidance is to vary the availability domain
(do not pin a fault domain) or retry later.

#### Constraint 2: idle reclamation — Always Free tenancies only; Pay As You Go is exempt

Oracle reclaims **idle Always Free compute instances**. Thresholds, read from Oracle's live
documentation (verified 2026-09-30), verbatim:

> **Reclamation of Idle Compute Instances**
>
> Idle Always Free compute instances may be reclaimed by Oracle. Oracle will deem virtual machine and
> bare metal compute instances as idle if, during a 7-day period, the following are true:
> - CPU utilization for the 95th percentile is less than 20%
> - Network utilization is less than 20%
> - Memory utilization is less than 20% (applies to A1 shapes only)

**The exemption is documented — in Oracle's reclamation notice, not on the Always Free resources
page.** This distinction caused an error in revision 1.3 and is corrected here.

The Always Free resources page states the thresholds but not who they bind. Oracle scopes the policy
in its reclamation notification, verbatim:

> OCI will be reclaiming idle Always Free compute resources from **Always Free customers only**.
>
> You can keep idle compute instances from being stopped by converting your account to **Pay As You Go
> (PAYG)**. With PAYG, you will not be charged as long as your usage for all OCI resources remains
> within the Always Free limits.

This wording is corroborated across Oracle's own Cloud Customer Connect forum, contemporaneous user
reports, and operators who have run idle A1 instances on PAYG without reclamation for years.

**Revision 1.3 was wrong to withdraw this.** It searched the Always Free resources page, found no
exemption clause, and concluded the mitigation had been removed — asserting "treat reclamation as
unmitigated" and "this residual risk is not mitigated by Pay As You Go." Both statements are false.
The absence of the clause from the documentation page is a documentation gap, not a policy reversal;
a documentation page is not where an operator scoping notice is published.

**Therefore: with the account converted to Pay As You Go, idle reclamation does not apply.**

Our relay workload, as measured in §10.1, remains idle by any measure: **CPU ~0.01% of one core,
memory ~45 MiB** (**0.37% memory utilisation** on a 12 GB shape). Correctly provisioned on PAYG, that
does not trigger reclamation.

**Practical consequence.** Design the relay to be disposable: rebuildable from the repository plus one
secret, with telemetry ingest resuming without operator action. The liveness probe below is therefore
the primary control, not a nice-to-have.

#### Boot volume: 47 GB minimum

A platform floor, not a sizing preference — and it overrides the §10.3 recommendation of a 10–20 GB
disk:

> The minimum boot volume size for each instance is 47 GB, regardless of shape. Your account comes
> with 200 GB of Always Free block volume storage which you use to create the boot volumes for your
> compute instances.

Provision the **47 GB minimum**; the relay holds no data (it forwards to Tier 1). A1 instances may be
created in any availability domain **except South Korea North (Chuncheon)**.

#### OCI-specific constraints to confirm at setup

| Item | Constraint |
|------|-----------|
| **Home region** | Always Free resources exist **only in the tenancy's home region**, which **cannot be changed after signup**. Must be an AU region (Sydney/Melbourne) for latency and data residency. Verify before provisioning. |
| **Allocation halving** | On 2026-06-15 Oracle cut the Arm allowance 4 OCPU/24 GB → 2 OCPU/12 GB with **no announcement**; instances were stopped until resized. Provision inside 2/12 from the start. Paid tenancies retained the old allowance. |
| **Idle reclamation** | Applies to **Always Free customers only**. Upgrading to Pay As You Go removes it (see Constraint 2). |
| **Budget alert** | On PAYG, exceeding Always Free limits **bills** rather than failing. Set a $0.01 budget alert with notifications so any unintended paid consumption is immediately visible. |
| **Outbound TCP 25** | Blocked by default. Not used by this system. |
| **Free-tier VCN cap** | Free-tier tenancies are limited to 2 VCNs. One is required. |
| **Boot volume floor** | Minimum boot volume is **47 GB** regardless of shape (see above) — overrides the 10–20 GB guidance in §10.3. |
| **Availability domains** | A1 instances may be created in any availability domain except **South Korea North (Chuncheon)**. Do not pin a fault domain on create. |

#### Residual risk accepted if OCI is chosen

The 2026-06-15 halving was applied silently and stopped running instances. The same class of change
could recur. If the relay is stopped, telemetry simply **stops arriving** — vehicles keep their config,
but no records reach Tier 1, producing silent gaps in insurer-relevant distance history. Two
mitigations, in order of value:

1. **External liveness probe** (independent of OCI) that alerts if no telemetry has arrived in N hours.
   Without this, a reclaimed instance is indistinguishable from a fleet of parked cars. **Required
   regardless of host.**
2. Oracle Notifications (Always Free, 1000 email/month) as a secondary channel.

**Idle reclamation is removed by Pay As You Go** (see Constraint 2). What remains is the ordinary risk
that the relay stops for some *other* reason — host failure, a bad deploy, an expired process — and
telemetry silently stops arriving. That risk is host-agnostic:

1. **External liveness probe** (independent of OCI) that alerts if no telemetry has arrived in N hours.
   Without this, a stopped relay is indistinguishable from a fleet of parked cars. **Required
   regardless of host.**
2. Oracle Notifications (Always Free, 1000 email/month) as a secondary channel.

The probe is cheap insurance, not a workaround for a platform deficiency. Because the 6-hour cadence
means a gap is not obvious for hours, it earns its place on any host — including a conventional VPS.

A conventional ~$5–6/month AU VPS (~$66/year) remains a legitimate alternative, but the earlier
framing of it as buying freedom from a *silent-reclamation* failure mode is withdrawn: on PAYG that
failure mode does not exist. The remaining difference is cost and operational familiarity, and **OCI
on PAYG is the lower-cost choice with no reclamation penalty.**

### 10.8 Provisioning runbook — Oracle Cloud, `ap-sydney-1`

**Scope.** Fresh Oracle Cloud host → relay streaming in production, as one deterministic sequence.
This is the materialisation of `infra/telemetry-relay/deploy.md` (§5).

**Execution status (rev 1.7) — the host-provisioning half has been EXECUTED.** Steps 0–5 below were
carried out on 2026-10-02 and the resulting instance is live; the facts table and OCIDs are therefore
*observed output*, not intended input. What remains **unexecuted** is everything that puts the relay on
the host: the container deploy (fleet-telemetry + the config-signing proxy), the certificate material, the Tesla
`fleet_telemetry_config` creation (F02-R10/R11), and the `--help` checks that rev 1.6 asked for. **No
Tesla telemetry config exists, so no vehicle is streaming and :443 answers nothing.**

The step numbering below is retained as authored. Read it as a record of a sequence whose first half is
done, not as an unrun plan.

#### Verified tenant facts (read-only inspection, 2026-10-02)

| Item | Verified value |
|------|----------------|
| Home region | `ap-sydney-1` (key `SYD`) — **immutable, set at signup** |
| Availability domains | **one**: `wWrd:AP-SYDNEY-1-AD-1` (Sydney is single-AD) |
| Tenancy | `renleding` (description `TENLS-6209`) |
| Account state | `payment-model: PAYG`, `start-date 2026-09-30` — **active** (O-7 resolved) |
| A1 capacity | **250 cores / 1,666 GB free** in AD-1, 0 used → no `Out of host capacity` wall |
| Existing VCN | `vcn-20261001-1101` · `10.0.0.0/16` · IGW + default route present — **reused** |
| Existing subnet | `subnet-20261001-1059` · `10.0.0.0/24` · public IPs allowed — **reused** |
| Security list | **hardened (rev 1.7)**: ingress is `443/tcp` (fleet-telemetry mTLS) + `22/tcp` **from the operator `/32` only** + ICMP type-3/code-4 (PMTU — must not be removed). The original `22` from `0.0.0.0/0` has been removed |
| Shape | `VM.Standard.A1.Flex` — **2 OCPU / 8 GB**, launched (arm64). Probed live at **6% memory used** (507 MB / 7,915 MB); the ~45 MiB relay working set needs a fraction of that |
| Image | Ubuntu 24.04 **aarch64** (arm64 confirmed against `VM.Standard.A1.Flex` before launch) |
| Boot volume | 47 GB floor, **no snapshot** (relay persists nothing) |
| Instance | `relay-afirmico-tesla` · **RUNNING** · public IP `158.180.7.252` · created 2026-10-02T13:15:06Z |

Verified OCIDs, so the runbook needs no console lookups:

```text
TENANCY   ocid1.tenancy.oc1..aaaaaaaajqsc5jlbueuszzeqaixfptdyzugl5m4mnnke25edomekyhras5wq
AD        wWrd:AP-SYDNEY-1-AD-1
VCN       ocid1.vcn.oc1.ap-sydney-1.amaaaaaamygtbziab27ksipjpj6pdr4cidtv26pdxe3d3lfpirmgc6eaysza
SUBNET    ocid1.subnet.oc1.ap-sydney-1.aaaaaaaa72bkr6mnudogzr5kpd6mae2xj2ahytherfocqh3iiynsjzto2xca
SECLIST   ocid1.securitylist.oc1.ap-sydney-1.aaaaaaaa4rt5vrnw6bqlmxddvl2txjvw5whlgsec2fw67ql3ywa7bsvqjdja
IGW       ocid1.internetgateway.oc1.ap-sydney-1.aaaaaaaarhlu7l6uk7phvqupygvsj3ln7t33tzqrx73rlrh6i3ldbebdnaoq
ROUTETBL  ocid1.routetable.oc1.ap-sydney-1.aaaaaaaaw3c35ujy4xlplib7vjrnq6nb3ht3mly5vppyxeeic3mipyifwj5q
IMAGE     ocid1.image.oc1.ap-sydney-1.aaaaaaaabtl4ncr2wrha5krfzl3etb66rpegvolpjgudr7nzvkkojpx33spa
```

#### Step 0 — Gate: confirm Pay As You Go is active

```bash
oci organizations subscription list --compartment-id "$TENANCY" \
  --query 'data.items[0].{"model":"payment-model"}'
```

**GATE SATISFIED (rev 1.7, 2026-10-02).** The subscription reports `payment-model: PAYG`, so the
condition this step refuses on no longer holds and the sequence proceeded. Retained as a gate description
because it records *why* the step existed; on a fresh tenancy it still applies verbatim — **if the
upgrade is pending, stop here and wait.**

#### Step 1 — Decide the admin access path *before* creating the instance

The relay must be reachable on `:443` from the internet. SSH must not be. §10.2 already states the
requirement ("22 must not be open"); this step is how the operator still gets in.

| Option | How it works | Assessment |
|--------|--------------|------------|
| **OCI Run Command** | Agent-executed command, **no inbound port at all** | **Preferred.** Needs only the Oracle Cloud Agent (default on Ubuntu images) + a service-gateway/NAT route. Zero network exposure, fully auditable. |
| OCI Bastion (managed SSH) | Time-limited (30–180 min) session via a bastion public endpoint | Strong second choice; requires the Bastion plugin *running* on the target and a route to the Oracle Services Network. **Whether the target may sit in a *public* subnet is unconfirmed (O-8)** — verify before relying on it. |
| Narrowed-CIDR `:22` | `22` from the operator's `/32` only, removed after bootstrap | Least preferred, but a legitimate bootstrap fallback when Run Command is unavailable. Must be **removed**, not left in place. |

The runbook assumes **Run Command**, so the instance is created with **no public IP** initially and no
world-open `22`. If Run Command turns out to be unavailable, fall back to a `/32`-scoped `22` and remove
the rule at the end of step 5.

#### Step 2 — Tighten the security list

Ingress becomes **exactly** what the design needs — nothing more. Write the intended rule set to a file
so the change is reviewable and idempotent, then apply it:

```json
[
  { "protocol": "6", "source": "0.0.0.0/0", "sourceType": "CIDR_BLOCK", "isStateless": false,
    "description": "Tesla fleet telemetry (mTLS) + ACME HTTP-01 fallback",
    "tcpOptions": { "destinationPortRange": { "min": 443, "max": 443 } } },
  { "protocol": "1", "source": "0.0.0.0/0", "sourceType": "CIDR_BLOCK", "isStateless": false,
    "description": "Path MTU discovery - do NOT remove",
    "icmpOptions": { "type": 3, "code": 4 } },
  { "protocol": "1", "source": "10.0.0.0/16", "sourceType": "CIDR_BLOCK", "isStateless": false,
    "icmpOptions": { "type": 3 } }
]
```

```bash
oci network security-list update --security-list-id "$SECLIST" \
  --ingress-security-rules file://ingress-rules.json
```

Two deliberate removals: **TCP 22 from `0.0.0.0/0`**, and world-wide ICMP. The ICMP type 3 / code 4 rule
is retained — removing it silently breaks path-MTU discovery and causes large transfers to hang. Egress
stays `all` (the relay must reach Tier 1 and Tesla).

**Host firewall is a second gate.** Oracle's Ubuntu images ship `iptables` rules that permit `:22` and
little else, so a security-list change alone is not enough:

```bash
# on the host, after the container is up
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

This is the single most commonly missed step on OCI — the port is open in the cloud and still unreachable.
Verify externally (step 8) rather than trusting either layer alone.

#### Step 3 — Reserve a static public IP

Reserved (not ephemeral), so the address survives instance replacement — which also settles the O-4
outbound-IP question in our favour if Tesla requires a static IP:

```bash
oci network public-ip create --compartment-id "$TENANCY" \
  --lifetime RESERVED --display-name afirmico-relay-ip
```

#### Step 4 — Launch the instance

Created with `--assign-public-ip false`; the reserved IP is attached to the private IP afterwards
(step 4b), because `instance launch` cannot attach a pre-existing reserved IP in one call.

```bash
oci compute instance launch --compartment-id "$TENANCY" \
  --availability-domain "$AD" \
  --shape VM.Standard.A1.Flex --shape-config '{"ocpus":1,"memoryInGBs":2}' \
  --image-id "$IMAGE" \
  --display-name afirmico-relay \
  --boot-volume-size-in-gbs 47 \
  --subnet-id "$SUBNET" \
  --assign-public-ip false \
  --ssh-authorized-keys-file ~/.ssh/afirmico_relay.pub
```

**Do not pin a fault domain** (Oracle's guidance on constrained capacity). Then attach the reserved IP to
the primary private IP:

```bash
oci compute instance list-vnics --instance-id "$INSTANCE" \
  --query 'data[0].{"privateIp":"private-ip","vnic":"id"}'   # note the PRIVATE IP ocid
oci network public-ip create --compartment-id "$TENANCY" \
  --lifetime RESERVED --private-ip-id "$PRIVATE_IP"
```

#### Step 5 — Base host setup

Applied via Run Command (or SSH). Ubuntu 24.04 LTS (§10.3); arm64 images, so `docker` must come from
Docker's arm64 repo — Oracle's default `docker.io` package is old and Compose v2 is absent.

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl chrony unattended-upgrades
# Docker Engine + Compose plugin from the official arm64 repo
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
docker compose version && docker run --rm --platform linux/arm64 hello-world
```

**Time sync is a correctness requirement, not hygiene** — client-certificate validation rejects on clock
skew. Confirm `chronyc tracking` shows a synced, low-offset source. Also set the Docker log driver to
`json-file` with `max-size`/`max-file` limits: §10.2 flags an unbounded stdout stream as the realistic way
to fill the disk, and both Tesla images log to stdout.

#### Step 6 — DNS and certificate

`telemetry.afirmi.co` → the reserved IP. The certificate **must be the full chain** (§10.4) because
vehicles verify the server:

```bash
sudo certbot certonly --standalone -d telemetry.afirmi.co   # :80 must be free while this runs
```

Renewal is a **launch-critical monitor**, not routine ops: per §7, an expired cert fails *silently* from
the vehicle's side — vehicles simply stop connecting. Wire renewal to reload the container and alert.

#### Step 7 — Bring up the relay

```bash
docker pull tesla/fleet-telemetry:latest
docker pull tesla/vehicle-command:latest
docker run -d --name fleet-telemetry --restart unless-stopped \
  --cap-add=NET_BIND_SERVICE \
  -p 443:443 \
  -v /etc/letsencrypt/live/telemetry.afirmi.co:/certs:ro \
  -v /opt/afirmico/server_config.json:/config/server_config.json:ro \
  --log-opt max-size=10m --log-opt max-file=3 \
  tesla/fleet-telemetry:latest --config /config/server_config.json
```

Config values come from §10.4 verbatim — in particular `tls.ca_file` **unset** in production, and the
`tesla-http-proxy` launched with `-host 127.0.0.1` (§10.4; the proxy must never be internet-facing). It
runs as a **configuration signer only** (F02-R11) — it signs the `fleet_telemetry_config` JWS, and no
vehicle command is sent. It has no part in the inbound vehicle-data path; that is fleet-telemetry's alone.
The images are `scratch`-based: there is no shell inside, so debugging is `docker logs` only.

#### Step 8 — Verify from outside the host

Not from the host itself — a loopback test proves nothing about the two firewall layers:

```bash
openssl s_client -connect telemetry.afirmi.co:443 -servername telemetry.afirmi.co </dev/null
```

Expected and **correct** results: the server chain validates, and then the session is **rejected** for
lacking a Tesla-issued client certificate. A connection that instead succeeds with any client cert is a
security failure — it would mean `RequireAndVerifyClientCert` is not in force. Then run Tesla's own
`check_server_cert.sh` (§8 item 2), which validates our chain only.

#### Step 9 — Only now, the Tesla app (R-01)

Sequence matters and is not arbitrary: Tesla fetches our public key from
`/.well-known/appspecific/com.tesla.3p.public-key.pem`, and that path is served by Tier 1 — which today
returns SPA HTML (§8 item 1, still failing). So the order is: **Tier 1 serves the key → relay verified →
developer app created → partner registration → vehicle pairing → config push → first records.** Registering
first produces a partner account whose key fetch fails, and Tesla does not restore telemetry configs after
a billing breach (§7, FRS R-07).

#### Step 10 — Cost and liveness controls

```bash
oci budgets budget create --compartment-id "$TENANCY" \
  --display-name afirmico-payg-alert \
  --amount 0.01 --reset-period MONTHLY \
  --targets '[{"type":"COMPARTMENT","values":["'"$TENANCY"'"]}]'
```

On PAYG, exceeding Always Free limits **bills** rather than failing (§10.7), so a $0.01 alert makes any
unintended paid consumption immediately visible, then attach a notification. Separately, the **external
liveness probe** (§10.7 residual risk, "required regardless of host") must be live before the first vehicle
pairs — with a 6-hour cadence a stopped relay is otherwise indistinguishable from a fleet of parked cars.

#### Disposal (deliberate, and cheap by design)

The relay is a disposable span port (§2 boundary rule), so removal is a bounded, auditable sequence:
terminate the instance → release the reserved IP → delete the security-list ingress rules → reuse or delete
the VCN. Rebuild is "repository + one secret", and re-pairing is **not** required for vehicles whose
telemetry config still points at the same hostname — though the server certificate is per-hostname, so a
replacement host must serve the same certificate.

---

## 11. Related Documents

| Artifact | Relation |
|----------|----------|
| [FRS-010](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md) | Requirements this SDD implements (v1.4 supersedes the polling transport) |
| [SDD-007](./SDD-007-action-ledger-budget-guardrails-v1.md) | Architectural precedent and document convention |
| `docs/engineering/tesla-public-key-custody-coordination.md` | SUPERSEDED — retained for history |
| `apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv` | 239-field catalog source (F03) |
| `apps/EdgeGDE - Document DB/Tesla APP DB/alert_dictionary.csv` | 18,436-alert dictionary source (F03) |
| https://developer.tesla.com/docs/fleet-api/fleet-telemetry | Transport, interval, and `include_fields` semantics |
| https://developer.tesla.com/docs/fleet-api/billing-and-limits | Pricing, billing-limit behaviour, rate limits |
| https://github.com/teslamotors/fleet-telemetry | Relay reference implementation |
| https://github.com/teslamotors/vehicle-command | `tesla-http-proxy` — config-JWS signer only (F02-R11); no vehicle commands are sent |
