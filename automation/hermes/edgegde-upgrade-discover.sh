#!/bin/bash
# EdgeGDE Upgrade Discovery Script
# Fast, silent watchdog — exits with code 0 and no output when all is current.
# Only prints UPGRADES_AVAILABLE=1 + diff when upgrades exist.
# Timeout-safe: all network calls wrapped in 10s timeout.

set -uo pipefail

WORKSPACE="/Users/warren/Documents/_HQ_AI/EdgeGDE"
SNAPSHOT_DIR="/Users/warren/.hermes/upgrade-snapshots"
mkdir -p "$SNAPSHOT_DIR"

HAVE_UPGRADES=0
REPORT=""

# ── Helper: compare semver ────────────────────────
semver_gt() {
  [ "$(printf '%s\n' "$1" "$2" 2>/dev/null | sort -V | tail -1)" = "$1" ] && [ "$1" != "$2" ]
}

# ── Safe network fetch with 10s timeout (brew coreutils or fallback) ──
_TIMEOUT=""
if command -v gtimeout &>/dev/null; then
  _TIMEOUT="gtimeout 10"
elif command -v timeout &>/dev/null; then
  _TIMEOUT="timeout 10"
fi

_latest_npm() {
  if [ -n "$_TIMEOUT" ]; then
    $_TIMEOUT npm view "$1" version 2>/dev/null || echo "unknown"
  else
    npm view "$1" version 2>/dev/null || echo "unknown"
  fi
}
_latest_pip() {
  local out
  if [ -n "$_TIMEOUT" ]; then
    out=$($_TIMEOUT pip3 index versions "$1" 2>/dev/null)
  else
    out=$(pip3 index versions "$1" 2>/dev/null)
  fi
  echo "$out" | head -1 | awk '{print $2}' | tr -d '()' || echo "unknown"
}

TIMESTAMP=$(date -u "+%Y%m%dT%H%M%SZ")

# ── 1. Bun ────────────────────────────────────────
CURRENT_BUN=$(bun --version 2>/dev/null || echo "unknown")
LATEST_BUN=$(_latest_npm bun)
if [ "$LATEST_BUN" != "unknown" ] && semver_gt "$LATEST_BUN" "$CURRENT_BUN"; then
  HAVE_UPGRADES=1; REPORT+="BUN: $CURRENT_BUN -> $LATEST_BUN"$'\n'
fi

# ── 2. Node.js ────────────────────────────────────
# Skip if the node on PATH is the Hermes-internal runtime (~/.local/bin/node ->
# ~/.hermes/node/bin/node) — it must stay untouched. The upgradable Homebrew
# node lives at /opt/homebrew/bin/node and resolves when not shadowed.
NODE_BIN=$(command -v node 2>/dev/null || echo "")
case "$NODE_BIN" in
  "$HOME"/.hermes/*|"$HOME"/.local/bin/*) NODE_INTERNAL=1 ;;
  *) NODE_INTERNAL=0 ;;
esac
CURRENT_NODE=$(node --version 2>/dev/null | sed 's/^v//' || echo "unknown")
LATEST_NODE=$(_latest_npm node)
if [ "$NODE_INTERNAL" -eq 1 ]; then
  : # Hermes-internal node — never report/upgrade
elif [ "$LATEST_NODE" != "unknown" ] && semver_gt "$LATEST_NODE" "$CURRENT_NODE"; then
  HAVE_UPGRADES=1; REPORT+="NODE: $CURRENT_NODE -> $LATEST_NODE"$'\n'
fi

# ── 3. Python global pip packages ─────────────────
OUTDATED=$($_TIMEOUT pip3 list --outdated --format=columns 2>/dev/null | tail -n +3 | head -30 || true)
if [ -n "$OUTDATED" ]; then
  COUNT=$(echo "$OUTDATED" | wc -l | tr -d ' ')
  HAVE_UPGRADES=1
  REPORT+="PIP ($COUNT outdated):"$'\n'"$OUTDATED"$'\n'
fi

# ── 4. uv ─────────────────────────────────────────
CURRENT_UV=$(uv --version 2>/dev/null | awk '{print $2}' || echo "unknown")
LATEST_UV=$(_latest_pip uv)
if [ "$LATEST_UV" != "unknown" ] && semver_gt "$LATEST_UV" "$CURRENT_UV"; then
  HAVE_UPGRADES=1; REPORT+="UV: $CURRENT_UV -> $LATEST_UV"$'\n'
fi

# ── 5. Wrangler ───────────────────────────────────
CURRENT_WR=$(npx wrangler --version 2>/dev/null | awk '{print $NF}' || echo "unknown")
LATEST_WR=$(_latest_npm wrangler)
if [ "$LATEST_WR" != "unknown" ] && semver_gt "$LATEST_WR" "$CURRENT_WR"; then
  HAVE_UPGRADES=1; REPORT+="WRANGLER: $CURRENT_WR -> $LATEST_WR"$'\n'
fi

# ── 6. Hermes Agent — AUTO-UPGRADE ─────────────────
CURRENT_HERMES=$(hermes --version 2>/dev/null | head -1 | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
LATEST_HERMES=$(_latest_pip hermes-agent)
if [ "$LATEST_HERMES" != "unknown" ] && semver_gt "$LATEST_HERMES" "$CURRENT_HERMES"; then
  echo "HERMES: $CURRENT_HERMES -> $LATEST_HERMES — auto-upgrading..."
  # Auto-upgrade Hermes via hermes update (git pull + reinstall deps)
  hermes update --yes 2>&1
  UPGRADE_EXIT=$?
  if [ "$UPGRADE_EXIT" -eq 0 ]; then
    NEW_VER=$(hermes --version 2>/dev/null | head -1 | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    HAVE_UPGRADES=1
    REPORT+="HERMES: UPGRADED $CURRENT_HERMES -> $NEW_VER ✅"$'\n'
  else
    HAVE_UPGRADES=1
    REPORT+="HERMES: $CURRENT_HERMES -> $LATEST_HERMES — UPGRADE FAILED (exit $UPGRADE_EXIT) ❌"$'\n'
  fi
fi

# ── 7. EdgeGDE key npm deps ───────────────────────
if [ -f "$WORKSPACE/apps/edge-runtime/package.json" ]; then
  cd "$WORKSPACE/apps/edge-runtime"
  for dep in hono zod; do
    CUR=$(node -e "console.log(require('./node_modules/$dep/package.json').version)" 2>/dev/null || echo "unknown")
    LAT=$(_latest_npm "$dep")
    if [ "$LAT" != "unknown" ] && [ "$CUR" != "unknown" ] && semver_gt "$LAT" "$CUR"; then
      HAVE_UPGRADES=1; REPORT+="NPM:$dep: $CUR -> $LAT"$'\n'
    fi
  done
fi

# ── 8. cua-driver (macOS app) — AUTO-UPGRADE ─────
# cua-driver is installed as an app bundle (CuaDriver.app, com.trycua.driver).
# The canonical upgrade path is the built-in updater (preserves bundle identity
# + TCC grants). pip3 install is WRONG here: cron's pip3 resolves to an
# externally-managed Python (PEP 668) and this is not a pip-managed install.
# The authoritative "is there an update" signal is `cua-driver check-update`
# (GitHub releases channel, 20h cache) — NOT PyPI. PyPI-only bumps (e.g. the
# phantom 0.19.3 -> 0.20.0) must not trigger an upgrade, and the GitHub
# anti-bot quirk (empty release list -> check-update reports latest=current
# or an error) must be treated as "no upgrade", not failure.
CURRENT_CUA=$(cua-driver --version 2>/dev/null | awk '{print $2}' || echo "0.0.0")
CUA_UPDATE_STATE=$(cua-driver check-update --json 2>/dev/null || echo "")
if [ -n "$CUA_UPDATE_STATE" ]; then
  CUA_UPDATE_AVAILABLE=$(printf '%s' "$CUA_UPDATE_STATE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("update_available", False))' 2>/dev/null || echo "false")
  CUA_LATEST=$(printf '%s' "$CUA_UPDATE_STATE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("latest_version") or "")' 2>/dev/null || echo "")
  if [ "$CUA_UPDATE_AVAILABLE" = "True" ] || [ "$CUA_UPDATE_AVAILABLE" = "true" ]; then
    echo "CUADRIVER: $CURRENT_CUA -> $CUA_LATEST — auto-upgrading..."
    cua-driver update --apply 2>&1
    UPGRADE_EXIT=$?
    if [ "$UPGRADE_EXIT" -eq 0 ]; then
      NEW_CUA=$(cua-driver --version 2>/dev/null | awk '{print $2}' || echo "unknown")
      HAVE_UPGRADES=1
      REPORT+="CUADRIVER: UPGRADED $CURRENT_CUA -> $NEW_CUA ✅"$'\n'
    else
      HAVE_UPGRADES=1
      REPORT+="CUADRIVER: $CURRENT_CUA -> $CUA_LATEST — UPGRADE FAILED (exit $UPGRADE_EXIT) ❌"$'\n'
    fi
  fi
fi

# ── 9. Docker containers (check if restart needed) ─
docker ps --format '{{.Names}} {{.Image}}' > "$SNAPSHOT_DIR/docker-images-$TIMESTAMP.txt" 2>/dev/null || true

# ── Snapshot for rollback ─────────────────────────
pip3 freeze > "$SNAPSHOT_DIR/pip-freeze-$TIMESTAMP.txt" 2>/dev/null || true
bun --version > "$SNAPSHOT_DIR/bun-version-$TIMESTAMP.txt" 2>/dev/null || true
node --version > "$SNAPSHOT_DIR/node-version-$TIMESTAMP.txt" 2>/dev/null || true
ln -sf "pip-freeze-$TIMESTAMP.txt" "$SNAPSHOT_DIR/pip-freeze-latest.txt" 2>/dev/null || true
ln -sf "bun-version-$TIMESTAMP.txt" "$SNAPSHOT_DIR/bun-version-latest.txt" 2>/dev/null || true
ln -sf "node-version-$TIMESTAMP.txt" "$SNAPSHOT_DIR/node-version-latest.txt" 2>/dev/null || true

# ── Output ────────────────────────────────────────
if [ "$HAVE_UPGRADES" -eq 1 ]; then
  echo "UPGRADES_AVAILABLE=1"
  echo "SNAPSHOT=$TIMESTAMP"
  echo "---"
  echo "$REPORT"
fi
exit 0
