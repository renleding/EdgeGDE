#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# EdgeGDE Mortgage Calculator — Deterministic Test Harness
# HSAES Phase 3.5: Integration smoke tests against the running Hono server.
#
# Usage:
#   Start the server first, then run this script.
#   ./test-harness.sh
#
# Failure rules:
#   set -e — ANY failure exits 1 immediately.
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
PASS=0
FAIL=0

# ── Colors ─────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✓${NC} $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}✗${NC} $1"
  exit 1  # set -e enforces this, but be explicit
}

echo "═══════════════════════════════════════════════════════════════════════"
echo "  EdgeGDE Mortgage Calculator — Test Harness"
echo "  Target: $BASE_URL"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# A. Health Check
# ═══════════════════════════════════════════════════════════════════════════

echo "── A. Health Check ────────────────────────────────────────────────"

HEALTHZ_RESPONSE=$(curl -f -s "${BASE_URL}/healthz")
if [ "$HEALTHZ_RESPONSE" = "ok" ]; then
  pass "GET /healthz → HTTP 200, body exactly 'ok'"
else
  fail "GET /healthz expected 'ok' but got: $HEALTHZ_RESPONSE"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# B. MCP Discovery Document
# ═══════════════════════════════════════════════════════════════════════════

echo "── B. MCP Discovery ───────────────────────────────────────────────"

MCP_RESPONSE=$(curl -f -s "${BASE_URL}/.well-known/mcp.json")

# Validate protocolVersion exists
if echo "$MCP_RESPONSE" | jq -e '.protocolVersion' > /dev/null 2>&1; then
  pass "MCP discovery has 'protocolVersion'"
else
  fail "MCP discovery missing 'protocolVersion'"
fi

# Validate tools exists and is a non-empty array
if echo "$MCP_RESPONSE" | jq -e '.tools | length > 0' > /dev/null 2>&1; then
  pass "MCP discovery has 'tools' with entries"
else
  fail "MCP discovery missing 'tools' or empty tools array"
fi

# Validate Cache-Control header
CACHE_HEADER=$(curl -f -s -I "${BASE_URL}/.well-known/mcp.json" 2>/dev/null | grep -i 'cache-control' | tr -d '\r')
if echo "$CACHE_HEADER" | grep -qi 'public.*max-age=60'; then
  pass "MCP discovery has 'Cache-Control: public, max-age=60'"
else
  fail "MCP discovery missing Cache-Control header: got '$CACHE_HEADER'"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# C. Mortgage Calculation
# ═══════════════════════════════════════════════════════════════════════════

echo "── C. Mortgage Calculation ──────────────────────────────────────────"

CALC_PAYLOAD='{
  "principal": 500000,
  "interestRate": 6.25,
  "loanTerm": 30
}'

CALC_RESPONSE=$(curl -f -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$CALC_PAYLOAD" \
  "${BASE_URL}/api/calc/mortgage")

if echo "$CALC_RESPONSE" | jq -e '.summary.monthlyRepayment' > /dev/null 2>&1; then
  MONTHLY=$(echo "$CALC_RESPONSE" | jq -r '.summary.monthlyRepayment')
  pass "Mortgage calculation includes 'monthlyRepayment' (value: $MONTHLY)"
else
  fail "Mortgage response missing 'monthlyRepayment'"
fi

# Validate fortnightlyRepayment
if echo "$CALC_RESPONSE" | jq -e '.summary.fortnightlyRepayment' > /dev/null 2>&1; then
  FORTNIGHTLY=$(echo "$CALC_RESPONSE" | jq -r '.summary.fortnightlyRepayment')
  pass "Mortgage calculation includes 'fortnightlyRepayment' (value: $FORTNIGHTLY)"
else
  fail "Mortgage response missing 'fortnightlyRepayment'"
fi

# Validate weeklyRepayment
if echo "$CALC_RESPONSE" | jq -e '.summary.weeklyRepayment' > /dev/null 2>&1; then
  WEEKLY=$(echo "$CALC_RESPONSE" | jq -r '.summary.weeklyRepayment')
  pass "Mortgage calculation includes 'weeklyRepayment' (value: $WEEKLY)"
else
  fail "Mortgage response missing 'weeklyRepayment'"
fi

# Validate totalInterest
if echo "$CALC_RESPONSE" | jq -e '.summary.totalInterest' > /dev/null 2>&1; then
  TOTAL_INT=$(echo "$CALC_RESPONSE" | jq -r '.summary.totalInterest')
  pass "Mortgage calculation includes 'totalInterest' (value: $TOTAL_INT)"
else
  fail "Mortgage response missing 'totalInterest'"
fi

# Validate totalCost
if echo "$CALC_RESPONSE" | jq -e '.summary.totalCost' > /dev/null 2>&1; then
  TOTAL_COST=$(echo "$CALC_RESPONSE" | jq -r '.summary.totalCost')
  pass "Mortgage calculation includes 'totalCost' (value: $TOTAL_COST)"
else
  fail "Mortgage response missing 'totalCost'"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "═══════════════════════════════════════════════════════════════════════"
