#!/bin/bash
# EdgeGDE Security Vulnerability Discovery Script
# Silent exit (no output) when clean — watchdog pattern.
set -uo pipefail

WORKSPACE="/Users/warren/Documents/_HQ_AI/EdgeGDE"
SD="/Users/warren/.hermes/upgrade-snapshots"
mkdir -p "$SD"
TS=$(date -u "+%Y%m%dT%H%M%SZ")
FOUND=0

# Clean up temp files on exit
trap 'rm -f "$SD/out-npm-$TS.txt" "$SD/out-pip-$TS.txt" "$SD/out-hermes-$TS.txt" "$SD/out-docker-$TS.txt" "$SD/imgs-$TS.txt"' EXIT

# ── Helper: run pip-audit with a Python-based timeout wrapper ──
# pip-audit downloads the vulnerability DB on first run (very slow).
# If the DB isn't cached, skip gracefully within 60s.
_run_pip_audit() {
  python3 -c "
import subprocess, sys, json
try:
    p = subprocess.run(
        [sys.executable, '-m', 'pip_audit', '--format', 'json'],
        capture_output=True, text=True, timeout=30
    )
    if p.returncode != 0:
        sys.exit(0)
    d = json.loads(p.stdout)
    vulns = d.get('vulnerabilities', [])
    if not vulns:
        sys.exit(0)
    print(f'PIP ({sys.argv[1]}): {len(vulns)} vulnerabilities')
    for v in vulns:
        sev = v.get('severity','?').upper()
        vid = v.get('id','?')
        pkg = v.get('name','?')
        ver = v.get('version','?')
        print(f'  {sev}: {vid} in {pkg} ({ver})')
except subprocess.TimeoutExpired:
    # DB not cached yet — skip this cycle
    pass
except Exception:
    pass
" "$1" 2>/dev/null || true
}

# ── 1. npm audit ───────────────────────────────────
if [ -f "$WORKSPACE/apps/edge-runtime/package.json" ]; then
  cd "$WORKSPACE/apps/edge-runtime" 2>/dev/null || true
  npm audit --json 2>/dev/null | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    vulns = d.get("vulnerabilities", {})
    if not vulns:
        sys.exit(0)
    total = len(vulns)
    print(f"NPM (EdgeGDE): {total} vulnerable packages")
    for name, v in vulns.items():
        sev = v.get("severity","")
        if sev in ("critical","high"):
            print(f"  {sev.upper()}: {name}")
except:
    pass
' > "$SD/out-npm-$TS.txt" 2>/dev/null || true
  if [ -s "$SD/out-npm-$TS.txt" ]; then
    FOUND=1
  fi
fi

# ── 2. pip-audit global ─────────────────────────────
_run_pip_audit "global" > "$SD/out-pip-$TS.txt" 2>/dev/null || true
if [ -s "$SD/out-pip-$TS.txt" ]; then
  FOUND=1
fi

# ── 3. pip-audit Hermes ────────────────────────────
HERMES_DIR="/Users/warren/Documents/_HQ_AI/hermes_workspace/hermes-agent"
if [ -d "$HERMES_DIR" ]; then
  cd "$HERMES_DIR" 2>/dev/null || true
  _run_pip_audit "Hermes" > "$SD/out-hermes-$TS.txt" 2>/dev/null || true
  if [ -s "$SD/out-hermes-$TS.txt" ]; then
    FOUND=1
  fi
fi

# ── 4. Docker via grype + podman (with 60s timeout per image) ──
# macOS lacks `timeout` command, so use perl-based timeout
if which grype >/dev/null 2>&1; then
  docker ps --format "{{.Image}}" 2>/dev/null | sort -u > "$SD/imgs-$TS.txt"
  while IFS= read -r img; do
    [ -z "$img" ] && continue
    # Timeout grype at 60s per image using perl
    perl -e 'alarm shift @ARGV; exec @ARGV' 60 grype "$img" --quiet -o json --only-fixed 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    matches = d.get('matches', [])
    if not matches:
        sys.exit(0)
    crit = [m for m in matches if m.get('vulnerability',{}).get('severity','')=='Critical']
    high = [m for m in matches if m.get('vulnerability',{}).get('severity','')=='High']
    med = [m for m in matches if m.get('vulnerability',{}).get('severity','')=='Medium']
    img = '$img'
    print(f'DOCKER ({img}): {len(crit)} crit, {len(high)} high, {len(med)} med (total w/ fixes: {len(matches)})')
    for m in (crit+high)[:6]:
        v = m.get('vulnerability',{})
        pkg = m.get('artifact',{}).get('name','?')
        ver = m.get('artifact',{}).get('version','?')
        print(f'  {v.get(\"severity\",\"?\")}: {v.get(\"id\",\"?\")} in {pkg} ({ver})')
except:
    pass
" >> "$SD/out-docker-$TS.txt" 2>/dev/null || true
  done < "$SD/imgs-$TS.txt"
  if [ -s "$SD/out-docker-$TS.txt" ]; then
    FOUND=1
  fi
fi

# ── Snapshot ───────────────────────────────────────
pip3 freeze > "$SD/pip-freeze-$TS.txt" 2>/dev/null || true

# ── Output ─────────────────────────────────────────
if [ "$FOUND" -eq 1 ]; then
  echo "VULNERABILITIES_FOUND=1"
  echo "TIMESTAMP=$TS"
  echo "---"
  [ -s "$SD/out-npm-$TS.txt" ] && cat "$SD/out-npm-$TS.txt"
  [ -s "$SD/out-pip-$TS.txt" ] && cat "$SD/out-pip-$TS.txt"
  [ -s "$SD/out-hermes-$TS.txt" ] && cat "$SD/out-hermes-$TS.txt"
  [ -s "$SD/out-docker-$TS.txt" ] && cat "$SD/out-docker-$TS.txt"
fi
exit 0
