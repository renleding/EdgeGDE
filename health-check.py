#!/usr/bin/env python3
"""Local service health check — probed by the system dashboard."""
import json, subprocess, urllib.request, sys

def check(host, port, label, path="/health/readiness"):
    try:
        r = urllib.request.Request(f"http://{host}:{port}{path}")
        with urllib.request.urlopen(r, timeout=3) as resp:
            return {"label": label, "status": "ok", "port": port}
    except Exception as e:
        return {"label": label, "status": "down", "port": port, "error": str(e).split(":")[0]}

def check_podman():
    try:
        r = subprocess.run(["podman", "ps", "--filter", "name=litellm", "--format", "{{.Status}}"],
                         capture_output=True, text=True, timeout=5)
        status = r.stdout.strip()
        if "Up" in status:
            return {"label": "Podman / LiteLLM", "status": "ok", "detail": status}
        return {"label": "Podman / LiteLLM", "status": "down", "detail": status or r.stderr.strip()}
    except Exception as e:
        return {"label": "Podman / LiteLLM", "status": "error", "detail": str(e)}

services = [
    check("127.0.0.1", 4000, "LiteLLM Proxy"),
    check("127.0.0.1", 8899, "System Dashboard", path="/"),
    check_podman(),
]

# Count statuses
ok = sum(1 for s in services if s["status"] == "ok")
down = sum(1 for s in services if s["status"] == "down")

output = {
    "services": services,
    "summary": f"{ok}/{len(services)} services ok",
    "all_ok": down == 0,
}

print(json.dumps(output))
