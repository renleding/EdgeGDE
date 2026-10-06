# Telemetry relay (Tier 2) — `infra/telemetry-relay/`

The Oracle Cloud host that terminates Tesla's inbound vehicle mTLS and forwards
payloads to Tier 1. Specified in SDD-010 §5 and §10; this directory is the deploy
unit.

```
  vehicle ──mTLS──▶ fleet-telemetry :443 ──stdout JSONL──▶ relay.py ──HTTPS──▶ Tier 1
                                                                        /ingest/telemetry
```

Host: `relay-afirmico-tesla` — Oracle Cloud `ap-sydney-1`, A1 arm64, 2 OCPU / 8 GB,
`158.180.7.252`.

## Why two components and not one

`fleet-telemetry` is Tesla's reference implementation and is the only thing that
should terminate the vehicle's client certificate. It writes each received payload
to stdout and then forgets it.

Nothing ships that stdout anywhere. `relay.py` is that component. It is deliberately
tiny and holds no state, because the relay is a **span port** (SDD-010 §2): it owns
no database, no schema, no derivation and no business logic. Consent, collection
tiers and field filtering are all Tier 1's job. A compromise of this host therefore
does not yield member data at rest.

## The one non-obvious thing

**`fleet-telemetry` does not emit the raw Tesla payload.** It emits a logrus log
line whose `data` object has already been transformed by
`datastore/simple/transformers/payload.go`. So a line looks like:

```json
{"activity":true,"level":"info","msg":"record_payload","time":"2026-10-02T21:00:00Z",
 "data":{"Vin":"5YJ..","CreatedAt":"2026-10-02T21:00:00Z","IsResend":false,
         "Odometer":{"doubleValue":12345.6},"CarType":"model3"}}
```

while Tier 1 expects the Tesla envelope:

```json
{"vin":"5YJ..","data":[{"key":"Odometer","value":{"doubleValue":12345.6},
                        "createdAt":"2026-10-02T21:00:00Z"}]}
```

`relay.py` performs that transform. **This is why `server_config.json` sets
`logger.verbose: true` and it is not cosmetic.**

With `verbose: false`, the transformer strips value types and emits an invalid
signal as the *string* `"<invalid>"`. Tier 1's `classifyValue()` correctly handles
the object form `{"invalid": true}` → `invalid`, but the string form falls through
to `stringValue` and is stored as **valid text**. That turns "the vehicle declined
to report this" into a measurement — indistinguishable downstream from a real
reading, and exactly the class of silent corruption this project has already been
bitten by twice. `verbose: true` makes every value an object and removes the
ambiguity structurally rather than by convention.

A test pins both forms: `test_bare_invalid_sentinel_is_not_a_measurement`.

## Files

| File | Purpose |
|------|---------|
| `relay.py` | The forwarder. Tails the container log, transforms, POSTs to Tier 1. |
| `test_relay.py` | Tests pinning the transform and the config invariants. `python3 -m unittest test_relay -v` |
| `server_config.json` | fleet-telemetry config. Mounted read-only into the container. |
| `journald-telemetry.conf` | → `/etc/systemd/journald.conf.d/99-telemetry-no-ratelimit.conf`. Disables journald rate limiting (a dropped line is lost member data) and bounds the journal by size. |
| `logrotate-afirmico-relay.conf` | → `/etc/logrotate.d/afirmico-relay`. Bounds the forwarder's log file. Uses `copytruncate` because the forwarder holds it open by inode. |
| `deploy.md` | Runbook: certs → container → forwarder → verify. |
| `check_server_cert.sh` | Tesla's own mTLS validator (pre-flight before configuring any vehicle). |

## Two settings that silently stop telemetry

Both were wrong in production and neither is detectable from Tier 1. See
`server_config.json`'s `_comment` and the headers of the two `.conf` files.

1. **`log_level` must be `info`.** The logger dispatcher emits each vehicle payload
   as an INFO `record_payload` line. At `warn` nothing is written that the
   forwarder can read. Observed: 3 days live, 84 signals billed by Tesla, 0 rows
   forwarded, and exactly one `record_payload` line ever written (the synthetic
   deploy self-test). Pinned by `TestServerConfig`.

2. **journald rate limiting must be off.** It drops over-limit lines *silently*;
   the forwarder's counters simply stop advancing. Disabled, with the journal
   bounded by `SystemMaxUse` instead.


## Configuration (environment, never a file)

`relay.py` takes all secrets from the environment. `INGEST_SHARED_SECRET` is read
from a systemd `EnvironmentFile` at mode `0600` and is never written into this
directory, never logged, and never included in an error message.

| Variable | Default | Purpose |
|----------|---------|---------|
| `INGEST_SHARED_SECRET` | — (**required**) | Auth to Tier 1. |
| `INGEST_URL` | `https://auto.afirmi.co/ingest/telemetry` | Ingest endpoint. |
| `CONTAINER_LOG` | `/opt/relay/logs/fleet-telemetry.log` | podman's log for the container. |
| `MAX_BATCH_BYTES` | `409600` | Relay-side batch cap, below Tier 1's 512 KiB limit. |
| `FLUSH_INTERVAL_SECONDS` | `30` | Max age before a partial batch is sent. |

Note the URL path: **`/ingest/telemetry`**. SDD-010 named it `/api/telemetry/ingest`
until rev 1.9, which would have 404'd every batch — see the SDD revision note.

## Testing

```bash
python3 infra/telemetry-relay/test_relay.py
```

The tests need no network and no container. They build fixtures from the shapes in
Tesla's transformer source, so a change in our transform that would silently
mislabels data fails here rather than in production.

## Known limits (stated, not hidden)

- **No on-disk queue.** A relay restart drops lines buffered between flushes. This is
  deliberate: a durable queue would put member data at rest on a box specified to
  hold none. Loss is bounded by `FLUSH_INTERVAL_SECONDS` and is counted.
- **The forwarder has never received a real vehicle payload.** It is verified against
  fixtures derived from Tesla's source and against Tier 1's parser, not against a live
  vehicle. First real traffic is the first true test.
- **`reliable_ack` is off.** Tesla's ack semantics need a durable dispatcher
  (`kafka`/`kinesis`/`redis`); with the `logger` dispatcher alone there is nothing to
  ack against. Revisit if loss proves material.
