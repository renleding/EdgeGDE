# Tesla Public Key — Custody and Parallel-Work Coordination

**Document ID:** ENG-TESLA-KEY-001  \
**Version:** 1.0  \
**Status:** Open — coordination required  \
**Author:** Hermes (Director)  \
**Date:** 2026-09-29  \
**Related:** `docs/FRS-010-afirmico-auto-tesla-fleet-data-v1.md` (F02-R01, F02-R02, R-08)

---

## 1. Purpose

Two agents are currently producing Tesla Fleet API artifacts on the same paths. This
note records the verified state of the public key material, the confirmed divergences
between the two workstreams, and the decisions required before Tesla partner
registration can succeed. It exists so the workstreams converge instead of
double-implementing.

It is a **coordination note, not a spec.** The requirements of record remain FRS-010.

---

## 2. Verified key-material inventory

Checked 2026-09-29 by reading both files and hashing them.

| Location | SHA-256 | Size | State |
| --- | --- | --- | --- |
| `apps/edge-runtime/public/.well-known/appspecific/com.tesla.3p.public-key.pem` | `50fc2f52…cec96` | 178 B | untracked |
| `apps/tesla-fleet-worker/public/.well-known/appspecific/com.tesla.3p.public-key.pem` | `50fc2f52…cec96` | 178 B | untracked |

**Finding:** the two copies are **byte-identical**. Both decode to a valid EC P-256
SubjectPublicKeyInfo. There is **no key conflict** — the risk is duplication of the
serving path, not divergent key material.

**Private key:** no `PRIVATE KEY` block exists anywhere under `apps/` (verified by
scan). The private key is not committed, which is correct. Its location of record is
still undocumented — this is the open half of R-08 (see §4.2).

---

## 3. Confirmed divergences

### 3.1 Two candidate serving paths for one required URL
Tesla requires exactly one reachable public key at:

```
https://auto.afirmi.co/.well-known/appspecific/com.tesla.3p.public-key.pem
```

Two untracked copies now exist in two different apps. Only one can serve
`auto.afirmi.co`. Until one is designated canonical, a registration attempt is
ambiguous and a later change to the other is a silent no-op.

### 3.2 Incorrect `Content-Type` in the worker implementation
`apps/tesla-fleet-worker/src/index.ts` serves the PEM with:

```
Content-Type: application/x-x509-ca-cert
```

FRS-010 **F02-R01** requires `application/x-pem-file`. These are different media
types; `application/x-x509-ca-cert` denotes a DER certificate, not a PEM public key.
This should be corrected before registration.

### 3.3 Divergent D1 schema for the same data
`apps/tesla-fleet-worker/migrations/0001_vehicle_snapshots.sql` defines a single
wide raw-JSON table:

```sql
vehicle_snapshots(id, vin, data TEXT /* JSON blob */, fetched_at, created_at)
```

FRS-010 **F08** specifies a different shape: a 239-row field **catalog** dimension
table, an **18,436-row alert dictionary** keyed `(signal_name, models)`, a **narrow
fact table** (`vin, ts, field_key, value_num/value_str/value_bool`), and raw payloads
to **R2**. The worker also binds its own D1 database (`9180fb6e-…` →
`afirmico-tesla-fleet-vehicles`), separate from `apps/edge-runtime`'s bindings.

Both shapes are defensible; keeping both is not. Storing raw vehicle payloads as
unbounded JSON blobs in D1 also sits awkwardly against F08's reason for R2 raw
storage (D1 row-size and cost limits).

### 3.4 Tooling divergence
`apps/tesla-fleet-worker/` uses **pnpm** (`pnpm-lock.yaml`). The repository standard is
**bun** (root `package.json`, and the CI workflows use `oven-sh/setup-bun` +
`bun install --frozen-lockfile`). A second package manager in-tree will not be
exercised by CI.

### 3.5 App duplication
`apps/tesla-fleet-worker/` is a new standalone Worker (`afirmico-tesla-fleet`) while
`apps/edge-runtime/` also carries the `.well-known` path and the D1 bindings FRS-010
assumes. Which one owns the Tesla integration is undecided.

---

## 4. Decisions required

### 4.1 Canonical owner (blocks registration)
Pick one: extend `apps/edge-runtime`, or adopt `apps/tesla-fleet-worker`. The `.well-known`
path, the D1 bindings, and the collector must all then live in that one app.

### 4.2 Private key custody (R-08, blocks nothing yet)
Record where the paired private key lives (secrets store path documented outside the
repo). Note that **Fleet API partner registration uploads only the public key**; the
private key is needed for vehicle *command* signing, which FRS-010 §Out of Scope
excludes. So the private key may legitimately be "generated, escrowed, unused at MVP"
— but that must be written down rather than assumed.

### 4.3 Schema reconciliation
Either adopt F08's catalog + narrow-fact + R2 design, or amend F08 to the blob design
with the trade-offs stated. Do not leave both.

### 4.4 Served `Content-Type`
Correct to `application/x-pem-file` per F02-R01.

---

## 5. Proposed resolution (for approval, not yet applied)

1. **Canonical:** keep the Tesla integration in `apps/tesla-fleet-worker/` (it is
   already purpose-built and isolated), and treat `apps/edge-runtime`'s `.well-known`
   copy as the duplicate to remove — **or** the reverse. Either way, delete one copy.
2. Fix `Content-Type` → `application/x-pem-file`, and serve from the canonical app.
3. Reconcile the D1 schema against FRS-010 F08 and update whichever side loses.
4. Switch `apps/tesla-fleet-worker/` to bun to match CI, or add a pnpm-aware CI job.
5. Add the private key's location of record to FRS-010 R-08 and close the risk.

Nothing in this section has been executed. Both workstreams' files are **untracked**
and were **not modified** by the author of this note.

---

## 6. Change Log

| Version | Date | Changes |
| --- | --- | --- |
| 1.0 | 2026-09-29 | Initial coordination note. Records identical key material, five divergences, four decisions. |
