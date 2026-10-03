# Deploying the telemetry relay

Runbook for `relay-afirmico-tesla` (`158.180.7.252`, Oracle Cloud `ap-sydney-1`).
This is the materialisation of SDD-010 §10.8. Holistic design lives there; this file
is the sequence an operator executes.

**Status: the host half is done; the service half is not.** The instance is live and
hardened. No container is running, no certificate exists, and `:443` accepts nothing.
`telemetry.afirmi.co` has **no DNS record yet**.

---

## Step 0 — Preconditions

| Check | Expected | Verify |
|-------|----------|--------|
| Host reachable | SSH as `ubuntu` | `ssh -i ~/.ssh/oci_relay_ed25519 ubuntu@158.180.7.252` |
| SSH restricted | operator IP only | security list `:22` = `<your-ip>/32` |
| `:443` admitted | TCP 443 open to `0.0.0.0/0` | security list; **plus** ICMP type 3 code 4 (see below) |
| PAYG active | no idle reclamation | OCI console → tenancy |
| DNS | `telemetry.afirmi.co` → `158.180.7.252` | `dig +short telemetry.afirmi.co` — **currently empty** |

ICMP type 3 / code 4 must stay permitted. It is not cosmetic: it is
fragmentation-needed for PMTU discovery, and removing it blackholes large TLS
handshakes — a failure that looks like a network outage and is not.

---

## Step 1 — DNS and the server certificate

Vehicles verify the server certificate, so this must exist **before** any vehicle is
configured. `fleet-telemetry` mounts it read-only from
`/etc/letsencrypt/live/telemetry.afirmi.co/`.

```bash
# On the relay host.
sudo apt-get update && sudo apt-get install -y certbot
sudo certbot certonly --standalone -d telemetry.afirmi.co \
  --agree-tos -m connect@afirmico.com --non-interactive
```

Renewal is **launch-critical, not routine**. An expired certificate fails silently
from the vehicle's side: vehicles simply stop connecting and nothing reports an
error (SDD-010 §7). Wire renewal to reload the container and to alert:

```bash
sudo systemctl enable --now certbot.timer
# verify the timer exists and next-run is set
sudo systemctl list-timers certbot.timer
```

---

## Step 2 — Secret file

`INGEST_SHARED_SECRET` must match the Worker secret of the same name. Retrieve it
from Bitwarden; never type it inline.

```bash
sudo install -d -m 0700 /etc/afirmico
sudo tee /etc/afirmico/relay.env >/dev/null <<'EOF'
INGEST_SHARED_SECRET=REPLACE_ME
INGEST_URL=https://auto.afirmi.co/ingest/telemetry
EOF
sudo chmod 0600 /etc/afirmico/relay.env
sudo chown root:root /etc/afirmico/relay.env
```

Note the path: **`/ingest/telemetry`**, not `/api/telemetry/ingest`. SDD-010 had this
wrong until rev 1.9; a relay built against the old path 404s every batch.

---

## Step 3 — fleet-telemetry container

```bash
sudo install -d -m 0755 /opt/relay/{config,logs,certs}
# ship server_config.json from this repo
sudo install -m 0644 server_config.json /opt/relay/config/server_config.json

sudo podman run -d --name fleet-telemetry --restart unless-stopped \
  --cap-add=NET_BIND_SERVICE \
  -p 443:443 \
  -v /etc/letsencrypt/live/telemetry.afirmi.co:/certs:ro \
  -v /opt/relay/config/server_config.json:/config/server_config.json:ro \
  --log-opt max-size=10m --log-opt max-file=3 \
  tesla/fleet-telemetry:latest --config /config/server_config.json
```

Firewall: podman writes its logs to the journal, so the container log is read with
`journalctl`, not a file (see Step 4). Only `443/tcp` is reachable.

The image is `scratch`-based — there is no shell inside it. Debugging is
`podman logs fleet-telemetry` and nothing else.

---

## Step 4 — The forwarder

`relay.py` tails the container's log and POSTs to Tier 1. It is the component that
actually ships the data; without it, `fleet-telemetry` writes to stdout and nothing
consumes it.

The container log location depends on how podman is configured. If the config sets
`log_driver = "k8s-file"` (podman's default in many distro builds), journald is not
used and the file lives under the container's log path — which is what
`CONTAINER_LOG` expects. Confirm before starting:

```bash
sudo podman inspect fleet-telemetry --format '{{.LogPath}}'
# If this prints a path, set CONTAINER_LOG to it and use the file-based service below.
# If it is empty, podman is using journald -- see the alternative service.
```

Install the forwarder:

```bash
sudo install -d -m 0755 /opt/relay
sudo install -m 0755 relay.py /opt/relay/relay.py
```

`/etc/systemd/system/relay-forwarder.service`:

```ini
[Unit]
Description=AFIRMICO telemetry relay forwarder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/afirmico/relay.env
Environment=CONTAINER_LOG=/opt/relay/logs/fleet-telemetry.log
ExecStart=/usr/bin/python3 /opt/relay/relay.py
Restart=always
RestartSec=5
# The relay is a span port: give it no filesystem write access and no shell escape.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/relay/logs

[Install]
WantedBy=multi-user.target
```

`CONTAINER_LOG` must match `podman inspect ... {{.LogPath}}` exactly. If podman is
using journald instead, replace `ExecStart` with a pipe from the journal:

```ini
ExecStart=/bin/bash -c '/usr/bin/journalctl -f -n 0 -o cat -u fleet-telemetry | /usr/bin/python3 /opt/relay/relay.py'
```

and set `CONTAINER_LOG=/dev/stdin`. **Do not guess which case applies** — check
`podman inspect` first. The forwarder waits for its log file to appear and says so;
it does not fail silently if the path is wrong, but it will simply never forward.

---

## Step 5 — Verify before configuring any vehicle

Do these in order. Each proves a distinct layer, and a later one passing does not
imply an earlier one did.

**5a. Forwarder reaches Tier 1.** `relay.py` logs a heartbeat every 5 minutes with
counters. Confirm ingestion independently of a vehicle by posting a synthetic line
into the log the forwarder is reading — this is the only way to test the transport
without hardware:

```bash
sudo python3 - <<'PY'
import json
line = {"activity": True, "level": "info", "msg": "record_payload",
        "time": "2026-10-02T21:00:00Z",
        "data": {"Vin": "SYNTHETIC0000000001", "CreatedAt": "2026-10-02T21:00:00Z",
                 "Odometer": {"doubleValue": 1.0}}}
open("/opt/relay/logs/fleet-telemetry.log", "a").write(json.dumps(line) + "\n")
PY
sudo journalctl -u relay-forwarder -n 20 --no-pager
```

Expect `batch_forwarded`. A synthetic VIN is deliberately not enrolled, so Tier 1
records a `failed` run with `unknown_vehicle` and writes zero facts — that is the
**correct** result and proves the path end to end including consent gating.

**5b. TLS certificate validates.** Run Tesla's own validator from a local machine,
not the host. `openssl s_client` should show the chain validating and then the
session being **rejected** for lacking a Tesla client certificate. A connection that
*accepts* any client cert is a security failure — it means
`RequireAndVerifyClientCert` is not in force.

```bash
openssl s_client -connect telemetry.afirmi.co:443 -servername telemetry.afirmi.co </dev/null
./check_server_cert.sh validate_server.json
```

**5c. Only then configure a vehicle** (Tier 1 side, F02-R10/R11). Sequence matters:
key served → relay verified → config pushed → first records.

---

## Rollback

The relay holds no data, so rollback is additive and cheap:

```bash
sudo systemctl stop relay-forwarder
sudo podman stop fleet-telemetry
```

Telemetry configs created on vehicles persist at Tesla and must be removed with the
`fleet_telemetry_config` delete endpoint (F02-R12). Stopping the relay alone leaves
vehicles retrying against a dead host.

---

## Open items this runbook does not close

- **R-07 (launch blocker).** A Tesla billing breach strips every telemetry config and
  Tesla does not restore them. The relay is the wrong place to detect this — it is
  Tier 1's `/healthz` and the billing alerts (F02-R13) that must catch it. Requires a
  tested re-apply runbook before go-live. **Detection is now built (FRS-010 v1.23):**
  `/healthz` reports `billing_margin` / `billing_projected_usd` / `billing_consumed`
  from the 10x margin check in `apps/afirmico-tesla/src/billing.ts`. The re-apply
  procedure is `reapply-runbook.md` beside this file — **steps 4-6 of it need the
  F02-R11 per-vehicle re-apply path, which does not exist yet**, so a breach can be
  detected but only repaired by hand. Still a launch blocker.
- **O-8.** Admin access path to the host. Currently SSH from one operator IP; no
  bastion decision has been made.
