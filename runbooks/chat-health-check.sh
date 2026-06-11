#!/usr/bin/env bash
# EdgeGDE — Chat Health Check Script
set -euo pipefail

WORKER="${1:-https://edgegde-calculator.renleding.workers.dev}"
TENANT="${2:-alpha-broker-01}"
FAILED=0

red() { echo -e "\033[0;31m$1\033[0m"; }
grn() { echo -e "\033[0;32m$1\033[0m"; }

echo "=== Chat Health Check ==="
echo "Worker: $WORKER | Tenant: $TENANT | $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# 1. Site loads
echo -n "1. Site loads: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${WORKER}/sites/${TENANT}")
[ "$CODE" = "200" ] && grn "PASS" || { red "FAIL ($CODE)"; FAILED=1; }

# 2. Chat init
echo -n "2. Chat init: "
SID=$(curl -s -X POST "${WORKER}/api/v1/chat/init?tenant=${TENANT}" -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))")
[ -n "$SID" ] && grn "PASS ($SID)" || { red "FAIL"; FAILED=1; }

# 3. Full flow
echo "3. Full flow (10 fields):"
FLOW_SID="$SID"
ST=1
for VAL in "Warren Smith" "warren@test.com" "0412345678" "Self-Employed" "85000" "500000" "650000" "Owner-occupied" "Yes" "No"; do
  echo -n "   $ST. \"$VAL\": "
  DONE=$(curl -s -X POST "${WORKER}/api/v1/chat/stream?tenant=${TENANT}" -H "Content-Type: application/json" -d "{\"session_id\":\"$FLOW_SID\",\"tool\":\"chat\",\"text\":\"$VAL\"}" --max-time 25)
  MSG=$(echo "$DONE" | python3 -c "import sys,json; lines=[l for l in sys.stdin.read().strip().split(chr(10)) if 'done' in l]; print(json.loads(lines[-1]).get('message','')[:60] if lines else 'no-response')" 2>/dev/null)
  echo "$MSG" | grep -qi "Thanks\|Thank you\|Welcome\|please provide\|valid" && grn "PASS" || { red "FAIL ($MSG)"; FAILED=1; }
  ST=$((ST+1))
  sleep 0.3
done

# 4. Invalid email
echo -n "4. Invalid email rejection: "
SID2=$(curl -s -X POST "${WORKER}/api/v1/chat/init?tenant=${TENANT}" -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))")
curl -s -X POST "${WORKER}/api/v1/chat/stream?tenant=${TENANT}" -H "Content-Type: application/json" -d "{\"session_id\":\"$SID2\",\"tool\":\"chat\",\"text\":\"John\"}" --max-time 20 > /dev/null 2>&1
sleep 0.5
DONE=$(curl -s -X POST "${WORKER}/api/v1/chat/stream?tenant=${TENANT}" -H "Content-Type: application/json" -d "{\"session_id\":\"$SID2\",\"tool\":\"chat\",\"text\":\"not-an-email\"}" --max-time 20)
MSG=$(echo "$DONE" | python3 -c "import sys,json; lines=[l for l in sys.stdin.read().strip().split(chr(10)) if 'done' in l]; print(json.loads(lines[-1]).get('message','') if lines else '')" 2>/dev/null)
echo "$MSG" | grep -qi "email\|@\|valid\|must be" && grn "PASS (${MSG:0:60})" || { red "FAIL (${MSG:0:60})"; FAILED=1; }

# 5. Invalid phone rejection (reuse session from test 3)
echo -n "5. Invalid phone rejection: "
DONE=$(curl -s -X POST "${WORKER}/api/v1/chat/stream?tenant=${TENANT}" -H "Content-Type: application/json" -d "{\"session_id\":\"$FLOW_SID\",\"tool\":\"chat\",\"text\":\"04111\"}" --max-time 20)
MSG=$(echo "$DONE" | grep "done" | python3 -c "import sys,json; d=json.loads(sys.stdin.read().strip()); print(d.get('message','')[:60] if d else 'no-msg')" 2>/dev/null)
echo "$MSG" | grep -qi "valid\|must be\|digit\|phone\|number\|10" && grn "PASS (${MSG:0:60})" || { red "FAIL (${MSG:0:60})"; FAILED=1; }

# 6. Dashboard
echo -n "6. Dashboard: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${WORKER}/dashboard")
[ "$CODE" = "200" ] && grn "PASS" || { red "FAIL ($CODE)"; FAILED=1; }

# 7. Health
echo -n "7. Health: "
STATUS=$(curl -s "${WORKER}/healthz")
[ "$STATUS" = "ok" ] && grn "PASS" || { red "FAIL ($STATUS)"; FAILED=1; }

echo ""
if [ "$FAILED" = "0" ]; then grn "✅ ALL TESTS PASSED"; else red "❌ SOME TESTS FAILED"; fi
exit $FAILED