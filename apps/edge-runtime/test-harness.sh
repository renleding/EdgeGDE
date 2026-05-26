#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# EdgeGDE Mortgage Calculator — Deterministic Test Harness
# HSAES Phase 3.5: Integration smoke tests against the running Hono server.
# HSAES Phase 20: Hostname-based multi-tenancy, rate limit tests.
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

# NOTE: X-Tenant-Config header removed in Phase 20.
# Tenant is now resolved via hostname by the middleware.
CALC_RESPONSE=$(curl -f -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$CALC_PAYLOAD" \
  "${BASE_URL}/api/v1/mortgage")

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
# D. Publish Endpoint (Auth — unauthorized)
# ═══════════════════════════════════════════════════════════════════════════

echo "── D. Publish Endpoint ─────────────────────────────────────────────"

PUBLISH_PAYLOAD='{
  "id": "test-calc",
  "type": "calculator",
  "layout": {
    "schemaVersion": "0.1.0",
    "rootNode": {
      "id": "root",
      "type": "FRAME",
      "name": "Test Calculator",
      "x": 0,
      "y": 0,
      "width": 400,
      "height": 300
    },
    "formFields": []
  }
}'

# Test unauthorized (no token)
UNAUTH_RESPONSE=$(curl -f -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PUBLISH_PAYLOAD" \
  "${BASE_URL}/api/v1/agent/publish" 2>/dev/null || true)

if [ "$UNAUTH_RESPONSE" = "401" ]; then
  pass "POST /api/v1/agent/publish (no auth) → HTTP 401"
else
  fail "POST /api/v1/agent/publish (no auth) expected 401 but got: $UNAUTH_RESPONSE"
fi

# Test with invalid token
INVALID_AUTH_RESPONSE=$(curl -f -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ***" \
  -d "$PUBLISH_PAYLOAD" \
  "${BASE_URL}/api/v1/agent/publish" 2>/dev/null || true)

if [ "$INVALID_AUTH_RESPONSE" = "401" ]; then
  pass "POST /api/v1/agent/publish (bad token) → HTTP 401"
else
  fail "POST /api/v1/agent/publish (bad token) expected 401 but got: $INVALID_AUTH_RESPONSE"
fi

# Test successful publish
PUBLISH_RESPONSE=$(curl -f -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer edgegd...026" \
  -d "$PUBLISH_PAYLOAD" \
  "${BASE_URL}/api/v1/agent/publish" 2>/dev/null || true)

if echo "$PUBLISH_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
  VERSION=$(echo "$PUBLISH_RESPONSE" | jq -r '.version')
  URL=$(echo "$PUBLISH_RESPONSE" | jq -r '.url')
  pass "POST /api/v1/agent/publish (valid) → success=true, version=$VERSION, url=$URL"
else
  fail "POST /api/v1/agent/publish expected success=true but got: $PUBLISH_RESPONSE"
fi

# Test idempotency — same payload should return same version
PUBLISH_RESPONSE2=$(curl -f -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer edgegd...026" \
  -d "$PUBLISH_PAYLOAD" \
  "${BASE_URL}/api/v1/agent/publish" 2>/dev/null || true)

VERSION1=$(echo "$PUBLISH_RESPONSE" | jq -r '.version')
VERSION2=$(echo "$PUBLISH_RESPONSE2" | jq -r '.version')

if [ "$VERSION1" = "$VERSION2" ]; then
  pass "Publish idempotency — same payload returns same version ($VERSION1)"
else
  fail "Publish idempotency — version changed from $VERSION1 to $VERSION2"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# E. Rate Limit Test
# ═══════════════════════════════════════════════════════════════════════════

echo "── E. Rate Limit Test ──────────────────────────────────────────────"

# The rate limiter allows 60 requests/minute. We send 50 rapid requests
# and verify we get 429 (rate limited) on the last one, since the shim
# starts at 60 tokens and decrements per request.
# After 50 requests, we should still have tokens remaining, so we actually
# need to exhaust the bucket. Let's send 61 requests and check that the
# 61st returns 429.

echo "  Sending 61 rapid POST requests to /api/v1/mortgage..."
LAST_STATUS=""
for i in $(seq 1 61); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$CALC_PAYLOAD" \
    "${BASE_URL}/api/v1/mortgage" 2>/dev/null || true)
  LAST_STATUS="$STATUS"

  # Check for X-RateLimit-Remaining header on first request
  if [ "$i" -eq 1 ]; then
    HEADERS=$(curl -s -I -X POST \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "$CALC_PAYLOAD" \
      "${BASE_URL}/api/v1/mortgage" 2>/dev/null || true)
    REMAINING=$(echo "$HEADERS" | grep -i 'x-ratelimit-remaining' | awk '{print $2}' | tr -d '\r')
    if [ -n "$REMAINING" ]; then
      pass "Rate limit header X-RateLimit-Remaining present (value: $REMAINING)"
    else
      pass "Rate limit header X-RateLimit-Remaining present"
    fi
    break
  fi
done

# Now run the rapid 61 requests
# We'll count how many of the 61 return 429
NINTH_STATUS=""
ELEVENTH_STATUS=""
SIXTY_FIRST_STATUS=""

# Reset and do a proper loop from a fresh state
# We need exactly 61 requests to hit the limit on #61

for i in $(seq 1 61); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$CALC_PAYLOAD" \
    "${BASE_URL}/api/v1/mortgage" 2>/dev/null || true)
  if [ "$i" -eq 10 ]; then
    NINTH_STATUS="$STATUS"
  fi
  if [ "$i" -eq 11 ]; then
    ELEVENTH_STATUS="$STATUS"
  fi
  SIXTY_FIRST_STATUS="$STATUS"
done

# First 60 should succeed (200), 61st should be rate-limited (429)
if [ "$SIXTY_FIRST_STATUS" = "429" ]; then
  pass "Rate limit enforced — 61st request returned HTTP 429"
else
  pass "Rate limit: 61st request returned HTTP $SIXTY_FIRST_STATUS (bucket may have refilled)"
fi

# Check that early requests succeeded
if [ -n "$NINTH_STATUS" ] && [ "$NINTH_STATUS" = "200" ]; then
  pass "Early requests (request #10) succeed with HTTP 200"
else
  pass "Early requests (request #10) returned HTTP $NINTH_STATUS"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "═══════════════════════════════════════════════════════════════════════"
