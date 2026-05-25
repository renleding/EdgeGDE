     1|#!/usr/bin/env bash
     2|# ═══════════════════════════════════════════════════════════════════════════
     3|# EdgeGDE Mortgage Calculator — Deterministic Test Harness
     4|# HSAES Phase 3.5: Integration smoke tests against the running Hono server.
     5|#
     6|# Usage:
     7|#   Start the server first, then run this script.
     8|#   ./test-harness.sh
     9|#
    10|# Failure rules:
    11|#   set -e — ANY failure exits 1 immediately.
    12|# ═══════════════════════════════════════════════════════════════════════════
    13|
    14|set -euo pipefail
    15|
    16|BASE_URL="${BASE_URL:-http://localhost:8787}"
    17|PASS=0
    18|FAIL=0
    19|
    20|# ── Colors ─────────────────────────────────────────────────────────────────
    21|GREEN='\033[0;32m'
    22|RED='\033[0;31m'
    23|NC='\033[0m' # No Color
    24|
    25|pass() {
    26|  PASS=$((PASS + 1))
    27|  echo -e "  ${GREEN}✓${NC} $1"
    28|}
    29|
    30|fail() {
    31|  FAIL=$((FAIL + 1))
    32|  echo -e "  ${RED}✗${NC} $1"
    33|  exit 1  # set -e enforces this, but be explicit
    34|}
    35|
    36|echo "═══════════════════════════════════════════════════════════════════════"
    37|echo "  EdgeGDE Mortgage Calculator — Test Harness"
    38|echo "  Target: $BASE_URL"
    39|echo "═══════════════════════════════════════════════════════════════════════"
    40|echo ""
    41|
    42|# ═══════════════════════════════════════════════════════════════════════════
    43|# A. Health Check
    44|# ═══════════════════════════════════════════════════════════════════════════
    45|
    46|echo "── A. Health Check ────────────────────────────────────────────────"
    47|
    48|HEALTHZ_RESPONSE=$(curl -f -s "${BASE_URL}/healthz")
    49|if [ "$HEALTHZ_RESPONSE" = "ok" ]; then
    50|  pass "GET /healthz → HTTP 200, body exactly 'ok'"
    51|else
    52|  fail "GET /healthz expected 'ok' but got: $HEALTHZ_RESPONSE"
    53|fi
    54|
    55|echo ""
    56|
    57|# ═══════════════════════════════════════════════════════════════════════════
    58|# B. MCP Discovery Document
    59|# ═══════════════════════════════════════════════════════════════════════════
    60|
    61|echo "── B. MCP Discovery ───────────────────────────────────────────────"
    62|
    63|MCP_RESPONSE=$(curl -f -s "${BASE_URL}/.well-known/mcp.json")
    64|
    65|# Validate protocolVersion exists
    66|if echo "$MCP_RESPONSE" | jq -e '.protocolVersion' > /dev/null 2>&1; then
    67|  pass "MCP discovery has 'protocolVersion'"
    68|else
    69|  fail "MCP discovery missing 'protocolVersion'"
    70|fi
    71|
    72|# Validate tools exists and is a non-empty array
    73|if echo "$MCP_RESPONSE" | jq -e '.tools | length > 0' > /dev/null 2>&1; then
    74|  pass "MCP discovery has 'tools' with entries"
    75|else
    76|  fail "MCP discovery missing 'tools' or empty tools array"
    77|fi
    78|
    79|# Validate Cache-Control header
    80|CACHE_HEADER=$(curl -f -s -I "${BASE_URL}/.well-known/mcp.json" 2>/dev/null | grep -i 'cache-control' | tr -d '\r')
    81|if echo "$CACHE_HEADER" | grep -qi 'public.*max-age=60'; then
    82|  pass "MCP discovery has 'Cache-Control: public, max-age=60'"
    83|else
    84|  fail "MCP discovery missing Cache-Control header: got '$CACHE_HEADER'"
    85|fi
    86|
    87|echo ""
    88|
    89|# ═══════════════════════════════════════════════════════════════════════════
    90|# C. Mortgage Calculation
    91|# ═══════════════════════════════════════════════════════════════════════════
    92|
    93|echo "── C. Mortgage Calculation ──────────────────────────────────────────"
    94|
    95|CALC_PAYLOAD='{
    96|  "principal": 500000,
    97|  "interestRate": 6.25,
    98|  "loanTerm": 30
    99|}'
   100|
   101|CALC_RESPONSE=$(curl -f -s \
   102|  -X POST \
   103|  -H "Content-Type: application/json" \
   104|  -H "Accept: application/json" \
   105|  -d "$CALC_PAYLOAD" \
   106|  "${BASE_URL}/api/calc/mortgage")
   107|
   108|if echo "$CALC_RESPONSE" | jq -e '.summary.monthlyRepayment' > /dev/null 2>&1; then
   109|  MONTHLY=$(echo "$CALC_RESPONSE" | jq -r '.summary.monthlyRepayment')
   110|  pass "Mortgage calculation includes 'monthlyRepayment' (value: $MONTHLY)"
   111|else
   112|  fail "Mortgage response missing 'monthlyRepayment'"
   113|fi
   114|
   115|# Validate fortnightlyRepayment
   116|if echo "$CALC_RESPONSE" | jq -e '.summary.fortnightlyRepayment' > /dev/null 2>&1; then
   117|  FORTNIGHTLY=$(echo "$CALC_RESPONSE" | jq -r '.summary.fortnightlyRepayment')
   118|  pass "Mortgage calculation includes 'fortnightlyRepayment' (value: $FORTNIGHTLY)"
   119|else
   120|  fail "Mortgage response missing 'fortnightlyRepayment'"
   121|fi
   122|
   123|# Validate weeklyRepayment
   124|if echo "$CALC_RESPONSE" | jq -e '.summary.weeklyRepayment' > /dev/null 2>&1; then
   125|  WEEKLY=$(echo "$CALC_RESPONSE" | jq -r '.summary.weeklyRepayment')
   126|  pass "Mortgage calculation includes 'weeklyRepayment' (value: $WEEKLY)"
   127|else
   128|  fail "Mortgage response missing 'weeklyRepayment'"
   129|fi
   130|
   131|# Validate totalInterest
   132|if echo "$CALC_RESPONSE" | jq -e '.summary.totalInterest' > /dev/null 2>&1; then
   133|  TOTAL_INT=$(echo "$CALC_RESPONSE" | jq -r '.summary.totalInterest')
   134|  pass "Mortgage calculation includes 'totalInterest' (value: $TOTAL_INT)"
   135|else
   136|  fail "Mortgage response missing 'totalInterest'"
   137|fi
   138|
   139|# Validate totalCost
   140|if echo "$CALC_RESPONSE" | jq -e '.summary.totalCost' > /dev/null 2>&1; then
   141|  TOTAL_COST=$(echo "$CALC_RESPONSE" | jq -r '.summary.totalCost')
   142|  pass "Mortgage calculation includes 'totalCost' (value: $TOTAL_COST)"
   143|else
   144|  fail "Mortgage response missing 'totalCost'"
   145|fi
   146|
   147|echo ""
   148|
   149|# ═══════════════════════════════════════════════════════════════════════════
   150|# Summary
   151|# ═══════════════════════════════════════════════════════════════════════════
   152|
   153|echo "═══════════════════════════════════════════════════════════════════════"
   154|echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
   155|echo "═══════════════════════════════════════════════════════════════════════"
   156|