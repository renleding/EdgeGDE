# System Control

Durable operational control files for the local Hermes / EdgeGDE workstation.

## Contents

- `system-architecture.yaml` — canonical system architecture and lifecycle spec.
- `system-dashboard.html` — local system health dashboard.
- `health-server.py` — health server probed by the dashboard.
- `health-check.py` — CLI health check used for verification.
- `launchd/` — launchd plists that should be installed into `~/Library/LaunchAgents`.
- `scripts/` — helper scripts for local services.

## Install launchd jobs

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.edgegde.health-server.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.edgegde.health-server.plist

launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hermes.system-dashboard.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hermes.system-dashboard.plist
```

## Verify

```bash
python3 health-check.py
curl -i http://127.0.0.1:8899/
```
