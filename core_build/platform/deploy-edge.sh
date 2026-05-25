     1|#!/usr/bin/env bash
     2|# ═══════════════════════════════════════════════════════════════════════════════
     3|# EdgeGDE Mortgage Calculator — Deterministic Deployment Pipeline
     4|# HSAES Phase 3.5 & 4: Remote edge simulation + production release.
     5|#
     6|# Usage:
     7|#   ./deploy-edge.sh
     8|#
     9|# Lifecycle:
    10|#   1. Start wrangler dev --remote on port 8787 (background)
    11|#   2. Probe /healthz until ready (max 30s)
    12|#   3. Run test-harness.sh for integration smoke tests
    13|#   4. Verify CLOUDFLARE_API_TOKEN is set
    14|#   5. wrangler deploy to production
    15|#   6. Cleanup: background worker killed via trap on any exit
    16|# ═══════════════════════════════════════════════════════════════════════════════
    17|
    18|set -euo pipefail
    19|
    20|# ── Color helpers ─────────────────────────────────────────────────────────────
    21|GREEN='\033[0;32m'
    22|RED='\033[0;31m'
    23|YELLOW='\033[0;33m'
    24|NC='\033[0m'
    25|
    26|BOLD='\033[1m'
    27|DIM='\033[2m'
    28|
    29|pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
    30|info()  { echo -e "  ${YELLOW}ℹ${NC} $1"; }
    31|fail()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }
    32|header(){ echo -e "\n${BOLD}$1${NC}"; echo -e "${DIM}──────────────────────────────────────────────${NC}"; }
    33|
    34|SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    35|cd "$SCRIPT_DIR"
    36|
    37|echo -e "${BOLD}"
    38|echo "═══════════════════════════════════════════════════════════════════════"
    39|echo "  EdgeGDE Mortgage Calculator — Deployment Pipeline"
    40|echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    41|echo "  Pipeline ID: dep-$(date +%s)-$$"
    42|echo "═══════════════════════════════════════════════════════════════════════"
    43|echo -e "${NC}"
    44|
    45|TOTAL_PASS=0
    46|TOTAL_FAIL=0
    47|
    48|# ═══════════════════════════════════════════════════════════════════════════════
    49|# Pre-flight: dependency check
    50|# ═══════════════════════════════════════════════════════════════════════════════
    51|
    52|header "Pre-flight Checks"
    53|
    54|WRANGLER_BIN=""
    55|if command -v wrangler &>/dev/null; then
    56|  WRANGLER_BIN="wrangler"
    57|elif command -v npx &>/dev/null && npx --no-install wrangler --version &>/dev/null 2>&1; then
    58|  WRANGLER_BIN="npx wrangler"
    59|fi
    60|
    61|if [ -z "$WRANGLER_BIN" ]; then
    62|  fail "wrangler CLI not found. Install with: npm install -g wrangler"
    63|fi
    64|pass "wrangler CLI available: $($WRANGLER_BIN --version 2>&1 | head -1)"
    65|
    66|if command -v jq &>/dev/null; then
    67|  pass "jq available"
    68|else
    69|  fail "jq not found. Install with: brew install jq"
    70|fi
    71|
    72|if [ -f "./test-harness.sh" ]; then
    73|  pass "test-harness.sh found"
    74|else
    75|  fail "test-harness.sh not found at repository root"
    76|fi
    77|
    78|# ── Wrangler config guard ─────────────────────────────────────────────────
    79|
    80|if [ ! -f "wrangler.json" ] && [ ! -f "wrangler.toml" ]; then
    81|  info "No wrangler.json or wrangler.toml found — create one before deploying"
    82|  info "Example: https://developers.cloudflare.com/workers/wrangler/configuration/"
    83|fi
    84|
    85|# ═══════════════════════════════════════════════════════════════════════════════
    86|# Phase 1: Start Edge Simulation (remote mode)
    87|# ═══════════════════════════════════════════════════════════════════════════════
    88|
    89|header "Phase 1: Remote Edge Simulation"
    90|
    91|PORT="${PORT:-8787}"
    92|
    93|info "Starting wrangler dev --remote on port ${PORT} ..."
    94|
    95|$WRANGLER_BIN dev --remote --port "$PORT" &
    96|WRANGLER_PID=$!
    97|info "Wrangler PID: $WRANGLER_PID"
    98|
    99|# ── Signal-safe cleanup trap ──────────────────────────────────────────────
   100|# Kills the background worker on any exit (success, failure, interrupt, term).
   101|# The '|| true' prevents the trap itself from causing exit-on-error.
   102|cleanup() {
   103|  local exit_code=$?
   104|  echo ""
   105|  if [ -n "${WRANGLER_PID:-}" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
   106|    echo -e "  ${YELLOW}ℹ${NC} Cleaning up background worker (PID $WRANGLER_PID) ..."
   107|    kill "$WRANGLER_PID" 2>/dev/null || true
   108|    wait "$WRANGLER_PID" 2>/dev/null || true
   109|    echo -e "  ${GREEN}✓${NC} Worker stopped"
   110|  fi
   111|  exit "$exit_code"
   112|}
   113|trap cleanup EXIT INT TERM
   114|
   115|# ── Deterministic health probe (max 30s) ──────────────────────────────────
   116|
   117|header "Phase 2: Health Probe"
   118|
   119|MAX_RETRIES=30
   120|RETRY_DELAY=1
   121|HEALTHY=false
   122|
   123|for ((i = 1; i <= MAX_RETRIES; i++)); do
   124|  if curl -fs "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
   125|    HEALTHY=true
   126|    break
   127|  fi
   128|  if [ "$i" -eq "$MAX_RETRIES" ]; then
   129|    echo ""
   130|    fail "Health probe failed after ${MAX_RETRIES}s — wrangler dev did not start"
   131|  fi
   132|  sleep "$RETRY_DELAY"
   133|done
   134|
   135|pass "GET /healthz → HTTP 200 (ready after ~${i}s)"
   136|
   137|# ═══════════════════════════════════════════════════════════════════════════════
   138|# Phase 3: Execute Test Harness
   139|# ═══════════════════════════════════════════════════════════════════════════════
   140|
   141|header "Phase 3: Integration Tests (test-harness.sh)"
   142|
   143|export BASE_URL="http://localhost:${PORT}"
   144|
   145|if bash ./test-harness.sh; then
   146|  pass "All integration tests passed"
   147|else
   148|  fail "Integration tests failed — see output above"
   149|fi
   150|
   151|# ═══════════════════════════════════════════════════════════════════════════════
   152|# Phase 4: Deployment Guard + Production Release
   153|# ═══════════════════════════════════════════════════════════════════════════════
   154|
   155|header "Phase 4: Production Release"
   156|
   157|# ── Environment guard ─────────────────────────────────────────────────────
   158|
   159|if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
   160|  fail "CLOUDFLARE_API_TOKEN is not set — deployment aborted"
   161|fi
   162|pass "CLOUDFLARE_API_TOKEN is set"
   163|
   164|if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
   165|  pass "CLOUDFLARE_ACCOUNT_ID is set"
   166|else
   167|  info "CLOUDFLARE_ACCOUNT_ID not set — wrangler may prompt for it"
   168|fi
   169|
   170|# ── Deploy ────────────────────────────────────────────────────────────────
   171|
   172|info "Running: wrangler deploy"
   173|$WRANGLER_BIN deploy
   174|pass "Deployment completed successfully"
   175|
   176|# ═══════════════════════════════════════════════════════════════════════════════
   177|# Summary
   178|# ═══════════════════════════════════════════════════════════════════════════════
   179|
   180|echo ""
   181|echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════${NC}"
   182|echo -e "  Pipeline complete — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
   183|echo -e "  Deployment pipeline finished successfully"
   184|echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════${NC}"
   185|