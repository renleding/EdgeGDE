# FEATURE-12: Vehicle Telemetry Configurator (STE-compliant)

## Summary

This feature makes the telemetry configuration operator-configurable at global, group, and per-vehicle scope. Resolution uses most-specific-wins with sparse inheritance. Changes stage in the console and apply through CI with an eligible canary.

## Functional Requirements

| ID | Requirement | Must/Should |
|----|-------------|-------------|
| F12-R01 | The platform shall support telemetry configuration at three scopes: global (all vehicles), group (a named set of members), and vehicle (one VIN). Resolution shall be most-specific-wins and shall be sparse. A field not specified at a more specific level inherits the value from the level above. | Must |
| F12-R02 | The global scope shall define every configurable field explicitly. No implicit default shall exist below the global scope. A field absent from every scope is a configuration error. The operator seeds the global tier from SYNC_INTERVAL_SECONDS with interval_seconds = 180 for every field. SYNC_INTERVAL_SECONDS remains the seed value. | Must |
| F12-R03 | The configurable surface per field shall be interval_seconds, minimum_delta, and an enabled/disabled flag. The enabled flag turns a field off from the console. | Must |
| F12-R04 | The effective configuration shall not collect any field outside CONSENTED_FIELDS. Overrides may narrow the collected set and shall not widen it. A hard gate enforces this before an artifact is built. CI asserts the gate. | Must |
| F12-R05 | Changes shall be staged in the console and applied through CI. The operator shall not change a vehicle configuration and have it reach the fleet without a reviewed, audited apply. The operator sets a target configuration. The pipeline commits and applies the target. | Must |
| F12-R06 | Every applied change shall be audited. The audit shall record scope, field(s), prior value, new value, operator, timestamp, and the resulting per-vehicle outcome. A change whose application cannot be evidenced from the audit trail shall not be reported as applied. | Must |
| F12-R07 | A global or group change shall be canaried. The change applies to exactly one eligible vehicle, is verified, and only then extends to the remaining vehicles. The canary shall be eligible. It shall not carry an override for any field the change touches. An override shadows the scoped value. A canary on an overridden vehicle would show no effect and be misread as a successful test. The operator nominates the canary. The operator picks a vehicle known to be in use. Adoption requires the vehicle to connect. A parked canary proves nothing. Eligibility is enforced. A nominated vehicle carrying an override for any field the change touches is rejected. A vehicle-scoped change does not require a canary. The apply is single-vehicle and is therefore its own canary. | Must |
| F12-R08 | Canary verification shall be evidence-based, not response-based, and shall require all three of: (a) the POST succeeded, (b) Tesla reports the vehicle holds a configuration (has_config: true) and has adopted the target (synced: true), and (c) new telemetry is observed afterwards. synced: true alone is not sufficient and shall not be treated as adoption. A vehicle with no configuration at all (has_config: false, key_paired: false, our record failed) reports synced: true because the flag means the vehicle adopted the target config. A vehicle with no target has nothing to adopt. A canary check reading synced alone would therefore report a failed configuration as adopted. A config can apply successfully and stop the stream. The request succeeded does not distinguish the two. | Must |
| F12-R09 | A failed canary stops the rollout and shall not proceed to the remaining vehicles. Partial application shall be reported per vehicle. Re-running shall be idempotent. A re-apply shall not double-apply or leave a vehicle in an indeterminate state. | Must |
| F12-R10 | The console shall show, per vehicle, the effective resolved configuration and the provenance of each value (global / group / vehicle). An operator can answer where a value came from without reading the database. | Must |
| F12-R11 | The console shall show each vehicle's applied vs. desired state. Drift — a staged change not yet applied, or a vehicle running an older config — is a visible state rather than something discovered from missing data. | Must |
| F12-R12 | The configurator shall not expose Pull/Push transport controls. Fleet Telemetry is push-only. The platform's config artifact carries only interval_seconds and minimum_delta per field. Presenting a transport control that has no effect at the vehicle would be an operator-facing lie. | Must |
| F12-R13 | Build order: the global scope and vehicle scope are built and shipped first. Group scope is added in a subsequent increment once the tesla_vehicle_group entity exists. The two scopes that are fully specified (global and vehicle) solve the stated problem (one vehicle differing from the rest) without waiting on the third. | Must |

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| F12-N01 | Resolution determinism: the same scope stack resolves to a byte-identical artifact. The artifact is built in sorted key order so a change is a reviewable diff. | — |
| F12-N02 | Blast-radius control: no single unscoped action can change every vehicle config without a canary and verification intervening. | — |
| F12-N03 | Staging isolation: a staged-but-unapplied target shall have no effect on any vehicle. | — |
| F12-N04 | Apply throughput at target scale: 1,000 vehicles must be appliable within the worker's request limits. The per-VIN loop shall be batched or scheduled rather than executed in a single request. | — |
| F12-N05 | Audit completeness: every applied change is reconstructable from the audit trail alone. | — |

## Acceptance Criteria

```text
AC1: A vehicle with no override resolves to exactly the global configuration. A vehicle with an override resolves to global+group+vehicle with the most specific value winning per field. Every other field inherits rather than reverting to a default.
AC2: A field absent from every scope is reported as a configuration error and no artifact is sent.
AC3: An override that disables a field removes it from that vehicle's artifact while the global default for every other vehicle is unchanged.
AC4: An override that would enable a field outside CONSENTED_FIELDS is refused before an artifact is built. CI fails on it.
AC5: Editing a scope in the console does not change any vehicle configuration until the change is applied through CI.
AC6: A global interval change applies to one eligible canary vehicle, confirms synced: true and a subsequent telemetry observation, and only then extends to the fleet.
AC7: A canary vehicle carrying an override for the changed field is excluded from canary selection.
AC8: A canary that fails to adopt stops the rollout. The remaining vehicles are untouched and the per-vehicle outcome is reported.
AC9: The console shows the effective value and its provenance (global/group/vehicle) for every field of a selected vehicle.
AC10: A staged change not yet applied is visible as drift and has no effect on the vehicle.
```

## Out of Scope

- Editing the field catalog itself (adding a field to the universe is F03/F08).
- Editing consent.
- Any per-field transport choice (F12-R12).