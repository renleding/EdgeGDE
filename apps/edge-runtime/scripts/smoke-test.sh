#!/usr/bin/env bash
set -euo pipefail

WORKER_URL="${WORKER_URL:-https://edgegde-calculator.renleding.workers.dev}"
TENANT="${TENANT:-afirmico}"
PASS=0
FAIL=0

check() {
  local name="$1" rc="$2"
  if [ "$rc" -eq 0 ]; then echo "  ✓ $name"; PASS=$((PASS+1))
  else echo "  ✗ $name"; FAIL=$((FAIL+1)); fi
}

echo "EdgeGDE Smoke Test — $WORKER_URL (tenant: $TENANT)"
echo ""

echo "── Health ──"
check "GET /healthz → 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$WORKER_URL/healthz" | grep -c '200' || true)"

echo "── Pipeline ──"
PIPE="$(curl -s "$WORKER_URL/api/v1/workspace/pipeline?tenant=$TENANT")"
check "HTML returned" "$(echo "$PIPE" | grep -cq 'hx-get' && echo 0 || echo 1)"
check "No error" "$(echo "$PIPE" | grep -cvq 'Pipeline error' && echo 0 || echo 1)"

echo "── MCP ──"
check "/.well-known/mcp.json → 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$WORKER_URL/.well-known/mcp.json" | grep -c '200' || true)"

echo "── Chat ──"
check "/chat/init → 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WORKER_URL/api/v1/chat/init?tenant=$TENANT" -H 'Content-Type: application/json' -d '{"objective":"mortgage_application"}' | grep -c '200' || true)"

if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "── Admin (auth) ──"
  check "/admin/health → 200" \
    "$(curl -s -o /dev/null -w '%{http_code}' "$WORKER_URL/api/v1/admin/health?tenant=$TENANT" -H "Authorization: Bearer ${ADMIN_TOKEN} 2>/dev/null | grep -c '200' || true)"
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ Smoke test passed"
