#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# EdgeGDE Mortgage Calculator — Deterministic Deployment Pipeline
# HSAES Phase 3.5 & 4: Remote edge simulation + production release.
#
# Usage:
#   ./deploy-edge.sh
#
# Lifecycle:
#   1. Start wrangler dev --remote on port 8787 (background)
#   2. Probe /healthz until ready (max 30s)
#   3. Run test-harness.sh for integration smoke tests
#   4. Verify CLOUDFLARE_API_TOKEN is set
#   5. wrangler deploy to production
#   6. Cleanup: background worker killed via trap on any exit
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Color helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

BOLD='\033[1m'
DIM='\033[2m'

pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
info()  { echo -e "  ${YELLOW}ℹ${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }
header(){ echo -e "\n${BOLD}$1${NC}"; echo -e "${DIM}──────────────────────────────────────────────${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BOLD}"
echo "═══════════════════════════════════════════════════════════════════════"
echo "  EdgeGDE Mortgage Calculator — Deployment Pipeline"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Pipeline ID: dep-$(date +%s)-$$"
echo "═══════════════════════════════════════════════════════════════════════"
echo -e "${NC}"

TOTAL_PASS=0
TOTAL_FAIL=0

# ═══════════════════════════════════════════════════════════════════════════════
# Pre-flight: dependency check
# ═══════════════════════════════════════════════════════════════════════════════

header "Pre-flight Checks"

WRANGLER_BIN=""
if command -v wrangler &>/dev/null; then
  WRANGLER_BIN="wrangler"
elif command -v npx &>/dev/null && npx --no-install wrangler --version &>/dev/null 2>&1; then
  WRANGLER_BIN="npx wrangler"
fi

if [ -z "$WRANGLER_BIN" ]; then
  fail "wrangler CLI not found. Install with: npm install -g wrangler"
fi
pass "wrangler CLI available: $($WRANGLER_BIN --version 2>&1 | head -1)"

if command -v jq &>/dev/null; then
  pass "jq available"
else
  fail "jq not found. Install with: brew install jq"
fi

if [ -f "./test-harness.sh" ]; then
  pass "test-harness.sh found"
else
  fail "test-harness.sh not found at repository root"
fi

# ── Wrangler config guard ─────────────────────────────────────────────────

if [ ! -f "wrangler.json" ] && [ ! -f "wrangler.toml" ]; then
  info "No wrangler.json or wrangler.toml found — create one before deploying"
  info "Example: https://developers.cloudflare.com/workers/wrangler/configuration/"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 1: Start Edge Simulation (remote mode)
# ═══════════════════════════════════════════════════════════════════════════════

header "Phase 1: Remote Edge Simulation"

PORT="${PORT:-8787}"

info "Starting wrangler dev --remote on port ${PORT} ..."

$WRANGLER_BIN dev --remote --port "$PORT" &
WRANGLER_PID=$!
info "Wrangler PID: $WRANGLER_PID"

# ── Signal-safe cleanup trap ──────────────────────────────────────────────
# Kills the background worker on any exit (success, failure, interrupt, term).
# The '|| true' prevents the trap itself from causing exit-on-error.
cleanup() {
  local exit_code=$?
  echo ""
  if [ -n "${WRANGLER_PID:-}" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    echo -e "  ${YELLOW}ℹ${NC} Cleaning up background worker (PID $WRANGLER_PID) ..."
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Worker stopped"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ── Deterministic health probe (max 30s) ──────────────────────────────────

header "Phase 2: Health Probe"

MAX_RETRIES=30
RETRY_DELAY=1
HEALTHY=false

for ((i = 1; i <= MAX_RETRIES; i++)); do
  if curl -fs "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo ""
    fail "Health probe failed after ${MAX_RETRIES}s — wrangler dev did not start"
  fi
  sleep "$RETRY_DELAY"
done

pass "GET /healthz → HTTP 200 (ready after ~${i}s)"

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 3: Execute Test Harness
# ═══════════════════════════════════════════════════════════════════════════════

header "Phase 3: Integration Tests (test-harness.sh)"

export BASE_URL="http://localhost:${PORT}"

if bash ./test-harness.sh; then
  pass "All integration tests passed"
else
  fail "Integration tests failed — see output above"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 4: Deployment Guard + Production Release
# ═══════════════════════════════════════════════════════════════════════════════

header "Phase 4: Production Release"

# ── Environment guard ─────────────────────────────────────────────────────

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  fail "CLOUDFLARE_API_TOKEN is not set — deployment aborted"
fi
pass "CLOUDFLARE_API_TOKEN is set"

if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  pass "CLOUDFLARE_ACCOUNT_ID is set"
else
  info "CLOUDFLARE_ACCOUNT_ID not set — wrangler may prompt for it"
fi

# ── Deploy ────────────────────────────────────────────────────────────────

info "Running: wrangler deploy"
$WRANGLER_BIN deploy
pass "Deployment completed successfully"

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "  Pipeline complete — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo -e "  Deployment pipeline finished successfully"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════${NC}"
