# Re-apply runbook — after a Tesla billing-limit breach

**Requirement:** FRS-010 F02-R13, F02-N04. **Severity:** highest in the system.

## What a breach actually does

When the Tesla Fleet API billing limit is reached, Tesla **strips every
`fleet_telemetry_config` from every vehicle and does not restore them.** This is
not a throttle and not a temporary outage. Confirmed against Tesla's billing
documentation (SDD-010 §11) and recorded as R-07.

Two consequences follow, and they are why this runbook exists:

1. **Collection stops silently.** Vehicles stop streaming to
   `telemetry.afirmi.co`. The receiver stays up and healthy — it has nothing to
   receive. Ingest counters fall to zero. Nothing at the relay can detect this,
   because the relay only forwards what arrives. That is why F02-R13 puts
   detection at **Tier 1 `/healthz`**, not at the relay.
2. **Recovery is not automatic.** Raising the limit does not bring the configs
   back. Every vehicle must be re-configured individually through
   `fleet_telemetry_config` (F02-R11).

## Detection

`GET https://auto.afirmi.co/healthz` now reports the billing guard:

```json
{
  "status": "ok",
  "problems": [],
  "checks": {
    "billing_margin": "18.4x",
    "billing_projected_usd": "0.0543",
    "billing_consumed": "0.001"
  }
}
```

Read it as follows:

| `checks.billing_margin` | meaning | action |
|---|---|---|
| `unconfigured` | `TESLA_BILLING_LIMIT_USD` is not set | **Set it.** The 10x margin cannot be verified. `/healthz` reports `degraded`. |
| `Nx` with no suffix | margin is at or above the 10x floor | none |
| `Nx BELOW_MIN` | margin is under 10x | raise the limit; `degraded` |
| `no_usage_yet` | limit set, no signals this month | none |
| `error: …` | the check itself failed | investigate D1 reachability |

`/healthz` turns `degraded` and adds a `problems` entry when the limit is
unset, when the margin is under 10x, at 80% consumed, and on a breach. The
status code stays 200 so that monitoring can distinguish "degraded" from "the
worker is down" — check the `status` field, not just the code.

**The 80% signal is the one that matters.** Beyond 80%, act before 100%. A
breach cannot be undone by paying; it has to be repaired.

## Re-apply procedure

> **Dependency:** steps 4–6 require the `fleet_telemetry_config` send path
> (F02-R11), which is **not yet built**. Until it is, a breach can be detected
> but not automatically repaired. Do not go live with vehicles paired until this
> runbook has been executed at least once against a real vehicle.

**1. Stop the bleeding.** Raise the Tesla developer-dashboard billing limit so
the breach cannot recur during repair. Set it to at least 10x the projected
monthly spend reported by `/healthz`.

**2. Record the breach.** Insert / confirm the `tesla_billing_guard` row:

```sql
SELECT guard_id, checked_at, limit_usd, usage_usd, projected_month,
       margin_ratio, breach_detected_at, remediation_state
  FROM tesla_billing_guard
 ORDER BY checked_at DESC LIMIT 5;
```

`remediation_state` is `detected`. It advances only by an explicit act —
nothing in the scheduled check clears it, because a later healthy reading does
**not** mean the fleet was repaired.

**3. Enumerate what must be restored.** Every vehicle with a paired key:

```sql
SELECT v.vin, c.state, c.config_version
  FROM tesla_vehicle v
  LEFT JOIN tesla_telemetry_config c ON c.vin = v.vin
 WHERE v.key_state = 'paired'
 ORDER BY v.vin;
```

Rows with `state = 'removed'` or no row at all are the ones to re-apply.

**4. Re-apply per vehicle.** Through `tesla-http-proxy` as a configuration
signer (F02-R11) — sign the `fleet_telemetry_config` JWS with the application
private key and POST it. The exact config sent is stored verbatim in
`tesla_telemetry_config.fields_json`; re-send that, not a freshly assembled one,
so a re-apply cannot silently widen the collected field set:

```bash
# Re-send the stored config for one VIN. fields_json is authoritative.
curl -sS -X POST "$TESLA_AUDIENCE/api/1/vehicles/$VIN/fleet_telemetry_config" \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @<(sqlite3 -json ... "SELECT fields_json FROM tesla_telemetry_config WHERE vin='$VIN'")
```

On success set `state='active'`, `applied_at=now`, and bump `config_version`.
On `skipped_vehicles`, record the per-VIN reason as a distinct state
(`missing_key`, `unsupported_hardware`, `unsupported_firmware`, `max_configs`) —
do not collapse these into a single "failed".

**5. Verify each vehicle is streaming.** Do not trust the POST's 200. Confirm
records actually arrive:

```sql
SELECT vin, max(created_at), count(*)
  FROM tesla_telemetry_fact
 WHERE created_at > datetime('now','-1 hour')
 GROUP BY vin;
```

A vehicle that accepted the config but sends nothing is not restored.

**6. Close the incident.** Only once every paired vehicle has been observed
streaming, set `remediation_state='configs_reapplied'`, then `= 'verified'`, and
write a `tesla_audit_event`. Leaving it at `detected` is the honest state if any
vehicle is unverified.

## Why the margin is 10x

F02-R13 requires the limit to sit at least 10x above projected usage. The
measured cost is ~17.5 signals/vehicle/day ≈ $0.0035/vehicle/month (SDD-010
§4.1), so a 10x margin is cents. The margin is not about cost — it is about the
fact that a breach is *unrecoverable in place*, so the limit must be far enough
away that a surprise (a firmware update that doubles emission, a field added at
the wrong cadence) cannot reach it before an operator notices.
