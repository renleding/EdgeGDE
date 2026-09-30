#!/bin/bash
# ═════════════════════════════════════════════════════════════════════════════
# Cubbit DS3 Daily Backup — EdgeGDE + Hermes Agent
# Overwrites "latest" each run, keeps dated copy + prunes beyond 14 dated copies.
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Load Cubbit credentials from ~/.hermes/.env ─────────────────────────
# Cron/launchd contexts do NOT inherit shell env, so boto3 was silently
# failing with "Unable to locate credentials" and the script exited 1.
# Use `set -a` so every var in .env is auto-exported.
if [ -f "$HOME/.hermes/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/.hermes/.env"
  set +a
fi
# Fail fast with a clear message if creds are missing (don't silently hang).
: "${CUBBIT_DS3_ACCESS_KEY_ID:?FATAL: CUBBIT_DS3_ACCESS_KEY_ID not set (check ~/.hermes/.env)}"
: "${CUBBIT_DS3_SECRET_ACCESS_KEY:?FATAL: CUBBIT_DS3_SECRET_ACCESS_KEY not set (check ~/.hermes/.env)}"
: "${CUBBIT_DS3_ENDPOINT_URL:?FATAL: CUBBIT_DS3_ENDPOINT_URL not set (check ~/.hermes/.env)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATE=$(date +%Y-%m-%d)
LOG="$SCRIPT_DIR/../logs/cubbit-backup-$(date +%Y-%m-%d).log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== Starting daily backup ==="

# ── 1. EdgeGDE backup ──────────────────────────────────────────────────────
EDGEGDE_SRC="$HOME/Documents/_HQ_AI/EdgeGDE"
EDGEGDE_TAR="/tmp/edgegde-backup-latest.tar.gz"

if [ -d "$EDGEGDE_SRC" ]; then
  log "Packaging EdgeGDE..."
  tar --exclude='node_modules' --exclude='.git' --exclude='.wrangler' \
    --exclude='*.db' --exclude='*.sqlite' --exclude='.routa*' \
    --exclude='*.tsbuildinfo' --exclude='dist' --exclude='build' \
    --exclude='*.env*' --exclude='*.log' --exclude='apps/ui-builder' \
    --exclude='apps/EdgeGDE - Document DB' --exclude='apps/Chrome Extension - Automation' \
    -czf "$EDGEGDE_TAR" -C "$EDGEGDE_SRC" . 2>&1 || {
    log "WARNING: EdgeGDE tar failed (exit $?) — skipping EdgeGDE backup"
    rm -f "$EDGEGDE_TAR"
  }
  if [ -f "$EDGEGDE_TAR" ]; then
    SIZE=$(du -h "$EDGEGDE_TAR" | cut -f1)
    log "EdgeGDE: $SIZE"
    cp "$EDGEGDE_TAR" "/tmp/edgegde-backup-${DATE}.tar.gz"
  else
    log "EdgeGDE: skipped (tar failed)"
  fi
else
  log "EdgeGDE source not found — skipping"
fi

# ── 2. Hermes Agent backup ─────────────────────────────────────────────────
HERMES_TAR="/tmp/hermes-agent-backup-latest.tar.gz"
HERMES_BUILD="/tmp/hermes-backup-build-$$"

rm -rf "$HERMES_BUILD"
mkdir -p "$HERMES_BUILD"/hermes-home

log "Packaging Hermes home..."
log "Skipping active state DB from backup (state.db/state.db-wal/state.db-shm)"
tar -cf - -C "$HOME" \
  --exclude='./.hermes/audio_cache' --exclude='./.hermes/image_cache' \
  --exclude='./.hermes/desktop' --exclude='./.hermes/hermes-office' \
  --exclude='./.hermes/hermes-agent.old' --exclude='./.hermes/sandboxes' \
  --exclude='./.hermes/cache' --exclude='./.hermes/lsp' \
  --exclude='./.hermes/state-snapshots' --exclude='./.hermes/state.db' \
  --exclude='./.hermes/state.db-wal' --exclude='./.hermes/state.db-shm' \
  .hermes 2>/dev/null | tar xf - -C "$HERMES_BUILD/hermes-home" 2>/dev/null || {
  cp -R "$HOME/.hermes/memories" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp -R "$HOME/.hermes/skills" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp -R "$HOME/.hermes/cron" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp -R "$HOME/.hermes/scripts" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp -R "$HOME/.hermes/plugins" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp -R "$HOME/.hermes/tools" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp -R "$HOME/.hermes/sessions" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/config.yaml" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/instructions.md" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/auth.json" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/.env" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/SOUL.md" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/decision_matrix.md" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  cp "$HOME/.hermes/kanban.db" "$HERMES_BUILD/hermes-home/" 2>/dev/null
  if [ -f "$HOME/.hermes/state.db" ]; then
    cp "$HOME/.hermes/state.db" "$HERMES_BUILD/hermes-home/" 2>/dev/null
    cp "$HOME/.hermes/state.db-wal" "$HERMES_BUILD/hermes-home/" 2>/dev/null || true
  fi
  cp "$HOME/.local/bin/hermes" "$HERMES_BUILD/hermes-home/bin/" 2>/dev/null || true
}

log "Packaging Hermes source..."
HERMES_SRC="$HOME/Documents/_HQ_AI/hermes_workspace/hermes-agent"
if [ -d "$HERMES_SRC" ]; then
  mkdir -p "$HERMES_BUILD/hermes-agent"
  tar -cf - --exclude='hermes-agent/.git' --exclude='hermes-agent/venv' \
    --exclude='hermes-agent/node_modules' --exclude='hermes-agent/hermes-hudui/venv' \
    --exclude='hermes-agent/hermes-hudui/frontend/node_modules' \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='dist' \
    --exclude='build' --exclude='*.egg-info' --exclude='.npm' \
    -C "$(dirname "$HERMES_SRC")" hermes-agent \
    2>/dev/null | tar xf - -C "$HERMES_BUILD" 2>/dev/null || true
fi

/usr/local/bin/pip3 freeze > "$HERMES_BUILD/requirements.txt" 2>/dev/null || true

cat > "$HERMES_BUILD/RESTORE.md" << 'README'
# Hermes Agent — Full Restoration
## Backup: ${DATE}

### Quick restore
```bash
tar xzf hermes-agent-backup-latest.tar.gz
rm -rf ~/.hermes && mv hermes-home ~/.hermes
mkdir -p ~/.local/bin && mv hermes-home/bin/hermes ~/.local/bin/hermes 2>/dev/null
mkdir -p ~/Documents/_HQ_AI/hermes_workspace
mv hermes-agent ~/Documents/_HQ_AI/hermes_workspace/hermes-agent 2>/dev/null
cd ~/Documents/_HQ_AI/hermes_workspace/hermes-agent 2>/dev/null && \
  python3 -m venv venv && source venv/bin/activate && \
  pip install -r ~/hermes-home/requirements.txt && pip install -e . || true
```

### Backup scope
- Includes Hermes home config, skills, memories, cron, scripts, plugins, tools, sessions, logs, and source.
- Excludes active SQLite state DB (`state.db*`) to keep daily backup bounded; rebuildable deps are excluded.
- Endpoint: https://s3.cubbit.eu
- Bucket: ag-ds3
- Account ID: cdb9bd3391e71153a361515c40e8410f
- Keys: stored in ~/.hermes/.env (CUBBIT_DS3_*)
README

log "Creating Hermes tarball..."
tar czf "$HERMES_TAR" -C "$HERMES_BUILD" . 2>&1
HERMES_SIZE=$(du -h "$HERMES_TAR" | cut -f1)
log "Hermes: $HERMES_SIZE"
cp "$HERMES_TAR" "/tmp/hermes-agent-backup-${DATE}.tar.gz"

rm -rf "$HERMES_BUILD"

# ── 3. Upload to Cubbit ────────────────────────────────────────────────────
log "Uploading to Cubbit DS3..."

/usr/local/bin/python3 - "$EDGEGDE_TAR" "/tmp/edgegde-backup-${DATE}.tar.gz" \
  "$HERMES_TAR" "/tmp/hermes-agent-backup-${DATE}.tar.gz" << 'PYEOF'
import os, sys, boto3

files = [f for f in sys.argv[1:] if f and os.path.exists(f)]
if not files:
    print("No files to upload")
    sys.exit(0)

session = boto3.Session(
    aws_access_key_id=os.environ.get('CUBBIT_DS3_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('CUBBIT_DS3_SECRET_ACCESS_KEY'),
    region_name=os.environ.get('CUBBIT_DS3_REGION', 'eu-west-1')
)
s3 = session.client('s3', endpoint_url=os.environ.get('CUBBIT_DS3_ENDPOINT_URL'))
bucket = os.environ.get('CUBBIT_DS3_BUCKET_NAME', 'ag-ds3')

for path in files:
    name = os.path.basename(path)
    key = f"backups/{name}"
    try:
        size = os.path.getsize(path)
        config = boto3.s3.transfer.TransferConfig(
            multipart_threshold=50 * 1024 * 1024,
            max_concurrency=8,
            multipart_chunksize=20 * 1024 * 1024,
            use_threads=True
        )
        with open(path, 'rb') as f:
            s3.upload_fileobj(f, bucket, key, Config=config)
        print(f"Uploaded: {key} ({size} bytes)")
    except Exception as e:
        print(f"Failed: {key} — {e}")
        sys.exit(1)

# ── 3b. Verify uploads landed (list bucket, confirm all 4 keys + non-trivial size) ──
from datetime import date
today = date.today().isoformat()
expected = {
    "backups/edgegde-backup-latest.tar.gz",
    f"backups/edgegde-backup-{today}.tar.gz",
    "backups/hermes-agent-backup-latest.tar.gz",
    f"backups/hermes-agent-backup-{today}.tar.gz",
}
found = {}
resp = s3.list_objects_v2(Bucket=bucket, Prefix='backups/')
for o in resp.get('Contents', []):
    found[o['Key']] = o['Size']
missing = [k for k in expected if k not in found]
small = [k for k in expected if k in found and found[k] < 10 * 1024 * 1024]
if missing or small:
    print(f"VERIFY FAILED: missing={missing} suspicious-small={small}")
    sys.exit(1)
print(f"VERIFY OK: all {len(expected)} expected keys present")
PYEOF

# ── 4. Prune old dated backups (keep 14 most recent dated copies) ─────────
log "Pruning old dated backups (keeping 14 per target)..."
/usr/local/bin/python3 << 'PYEOF'
import os, re, boto3
from datetime import datetime

session = boto3.Session(
    aws_access_key_id=os.environ.get('CUBBIT_DS3_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('CUBBIT_DS3_SECRET_ACCESS_KEY'),
    region_name=os.environ.get('CUBBIT_DS3_REGION', 'eu-west-1')
)
s3 = session.client('s3', endpoint_url=os.environ.get('CUBBIT_DS3_ENDPOINT_URL'))
bucket = os.environ.get('CUBBIT_DS3_BUCKET_NAME', 'ag-ds3')

KEEP = 14
DATE_RE = re.compile(
    r'^backups/(edgegde-backup|hermes-agent-backup)-(\d{4}-\d{2}-\d{2})\.tar\.gz$'
)

resp = s3.list_objects_v2(Bucket=bucket, Prefix='backups/')
keys = [o['Key'] for o in resp.get('Contents', [])]
by_target = {}
for k in keys:
    m = DATE_RE.match(k)
    if m:
        by_target.setdefault(m.group(1), []).append((m.group(2), k))

for target, items in by_target.items():
    items.sort()  # chronological by date string
    excess = items[:-KEEP] if len(items) > KEEP else []
    for _, key in excess:
        try:
            s3.delete_object(Bucket=bucket, Key=key)
            print(f"Pruned: {key}")
        except Exception as e:
            print(f"Prune FAILED: {key} — {e}")
PYEOF

log "=== Backup complete ==="
log "EdgeGDE: edgegde-backup-latest + edgegde-backup-${DATE}"
log "Hermes: hermes-agent-backup-latest + hermes-agent-backup-${DATE}"
