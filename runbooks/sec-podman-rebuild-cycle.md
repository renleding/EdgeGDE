# Sec-Podman-Rebuild Cycle

**Owner:** Hermes (planner/governor), Droid (executor)
**Scope:** Closes CVEs flagged by `edgegde-security-scan.sh` for signoz-* + litellm-proxy containers
**Repo:** Container build contexts live OUTSIDE the EdgeGDE git repo (sibling podman workspace)
**Trigger:** Any `SEC-NOTIFY ... HIGH CVEs` or `CRITICAL CVEs` message in any channel

## When to use this runbook

1. `~/.hermes/upgrade-snapshots/enriched-<TS>.json` has CRITICAL or HIGH entries
2. `podman images | grep signoz` shows the running image is not the latest `patched-*` tag
3. Kanban `t_<uuid>` cards in `ready` state matching container names

## Version bump reference (2026-09-02 batch)

| Container | Component | Current | Fix |
|-----------|-----------|---------|-----|
| signoz-otel-collector | golang.org/x/crypto | v0.31.0 | **0.52.0** |
| signoz-otel-collector | google.golang.org/grpc | v1.67.1 | **1.79.3** |
| signoz-otel-collector | stdlib (Go) | 1.23.6 | **1.24.13** |
| signoz-query-service | github.com/jackc/pgx/v5 | v5.7.2 | **5.9.0** |
| signoz-query-service | stdlib (Go) | 1.22.7 | **1.25.10** |
| signoz-zookeeper | netty-handler | 4.1.113.Final | **4.1.135.Final** |
| signoz-zookeeper | jetty-http | 9.4.56 | **9.4.60** |
| signoz-zookeeper | zookeeper | 3.9.3 | **3.9.5** |
| signoz-alertmanager | stdlib (Go) | 1.21.13 | **1.24.13** |
| litellm-proxy | restrictedpython | 8.1 | **8.3** |

## Cycle (8 steps)

### Step 1 — Confirm + register
- Open Mission Manifest at `.hermes/missions/sec-<DATE>-cve-batch.yaml`
- Update kanban `t_<uuid>` cards with batch details
- Reference FRS `FRS-SEC-<DATE>-CVE-BATCH`

### Step 2 — Pin versions
- For each container, edit the build context (Dockerfile / pom.xml / requirements.txt / go.mod)
- Apply the version bumps from the table above
- For Go: update `go.mod` AND `Dockerfile FROM golang:X.Y.Z` base
- For Java: update `pom.xml` or `build.gradle`
- For Python: update `requirements.txt`

### Step 3 — Build images
```bash
cd /path/to/podman-workspace  # NOT the EdgeGDE git repo
podman build -t signoz-otel-collector:patched-<DATE> -f signoz/otel-collector/Dockerfile .
podman build -t signoz-query-service:patched-<DATE> -f signoz/query-service/Dockerfile .
podman build -t signoz-zookeeper:patched-<DATE> -f signoz/zookeeper/Dockerfile .
podman build -t signoz-alertmanager:patched-<DATE> -f signoz/alertmanager/Dockerfile .
podman build -t litellm-proxy:patched-<DATE> -f litellm-proxy/Dockerfile .
```

### Step 4 — Trivy scan each new image
```bash
for img in signoz-otel-collector signoz-query-service signoz-zookeeper signoz-alertmanager litellm-proxy; do
  echo "=== $img ==="
  podman run --rm aquasec/trivy:latest image --severity HIGH,CRITICAL \
    --no-progress "localhost/$img:patched-<DATE>" 2>&1 | tail -20
done
```
**Expect 0 HIGH, 0 CRITICAL** for each.

### Step 5 — Update compose to use new tag
- Edit `compose.yml` (or podman equivalent) to point at `patched-<DATE>` for each service
- Save a copy of the pre-change compose as `compose.yml.pre-sec-<DATE>`

### Step 6 — Restart containers
```bash
podman compose -f compose.yml up -d
sleep 30  # let services settle
podman ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

### Step 7 — Health checks
```bash
# signoz
curl -sf http://localhost:3301/api/v1/health | jq -e '.status == "ok"'
# litellm-proxy
curl -sf http://localhost:4000/health/liveliness | jq -e '.status == "alive"'
```

### Step 8 — Re-run security scan
```bash
bash ~/.hermes/scripts/edgegde-security-scan.sh
# Expect: no HIGH/CRITICAL output (silent exit = clean)
```

## Rollback

If any container fails health check:
```bash
podman compose -f compose.yml down
cp compose.yml.pre-sec-<DATE> compose.yml
podman compose -f compose.yml up -d
```

## Pitfalls

1. **Go stdlib bump in `otel-collector`** — requires bumping both `go.mod` AND the `FROM golang:X.Y.Z` base image line. Missing one = silent regression.
2. **Litellm RestrictedPython 8.3** — pip install alone is NOT enough. Rebuild the image with the new requirements.txt, or `pip install --upgrade` then restart the container (in-place is faster but riskier).
3. **Zookeeper netty/jetty** — both must bump together; partial bump = runtime classpath errors.
4. **Compose tag edit** — verify the YAML indentation. Tabs break podman-compose.

## Reference

- Source scan: `~/.hermes/upgrade-snapshots/enriched-<TS>.json`
- FRS: `.hermes/missions/sec-<DATE>-cve-batch.yaml`
- Kanban cards: `t_<uuid>` matching each container
- Daily 5am AEST cron: `EdgeGDE Security Vulnerability Agent` runs `edgegde-security-scan.sh`
