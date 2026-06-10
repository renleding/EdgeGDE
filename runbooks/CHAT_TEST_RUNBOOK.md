---
runbook: chat_test
version: v1
created: 2026-06-10

worker_url: https://edgegde-calculator.renleding.workers.dev
tenant: alpha-broker-01

requires: []
outputs:
  - test_summary
---

# Chat Health Check Runbook

> Executes the full chat test suite against a tenant.
> Follow phases sequentially. Stop on any failure.

---

## Phase 1: Environment Verification

**Intent:** Confirm the worker is reachable and chat endpoint responds.

### 1.1 Verify site loads

```http exec
curl -s -o /dev/null -w "%{http_code}" \
  "${worker_url}/sites/${tenant}"
```

```json expected
{"status_code": "200"}
```

### 1.2 Verify chat init

```http exec
curl -s -X POST "${worker_url}/api/v1/chat/init?tenant=${tenant}" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('sessionId') else 'fail')"
```

```json expected
{"session_created": true}
```

---

## Phase 2: Field Collection Flow

**Intent:** Verify all 10 fields can be collected without repeats.

### 2.1 Collect full name

```http exec
SID=$(curl -s -X POST "${worker_url}/api/v1/chat/init?tenant=${tenant}" \
  -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))")
echo "$SID"
```

Store `$SID` for subsequent steps.

### 2.2 Send each field

```http exec
for FIELD in "Warren Smith" "warren@test.com" "0412345678" "Self-Employed" "85000" "500000" "650000" "Owner-occupied" "Yes" "No"; do
  curl -s -X POST "${worker_url}/api/v1/chat/stream?tenant=${tenant}" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool\":\"chat\",\"text\":\"$FIELD\"}" --max-time 25 | grep "done" > /dev/null && echo "OK: $FIELD" || echo "FAIL: $FIELD"
done
```

```json expected
{"all_fields_collected": true}
```

---

## Phase 3: Validation Enforcement

**Intent:** Verify invalid inputs are rejected with useful messages.

### 3.1 Invalid email

```http exec
SID=$(curl -s -X POST "${worker_url}/api/v1/chat/init?tenant=${tenant}" \
  -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))")
curl -s -X POST "${worker_url}/api/v1/chat/stream?tenant=${tenant}" \
  -H "Content-Type: application/json" -d "{\"session_id\":\"$SID\",\"tool\":\"chat\",\"text\":\"John\"}" --max-time 20 > /dev/null 2>&1
curl -s -X POST "${worker_url}/api/v1/chat/stream?tenant=${tenant}" \
  -H "Content-Type: application/json" -d "{\"session_id\":\"$SID\",\"tool\":\"chat\",\"text\":\"not-an-email\"}" --max-time 20 | grep "done"
```

```json expected
{"message_contains": ["email", "valid"]}
```

### 3.2 Invalid phone

```http exec
SID=$(curl -s -X POST "${worker_url}/api/v1/chat/init?tenant=${tenant}" \
  -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))")
curl -s -X POST "${worker_url}/api/v1/chat/stream?tenant=${tenant}" \
  -H "Content-Type: application/json" -d "{\"session_id\":\"$SID\",\"tool\":\"chat\",\"text\":\"John\"}" --max-time 20 > /dev/null 2>&1
curl -s -X POST "${worker_url}/api/v1/chat/stream?tenant=${tenant}" \
  -H "Content-Type: application/json" -d "{\"session_id\":\"$SID\",\"tool\":\"chat\",\"text\":\"john@test.com\"}" --max-time 20 > /dev/null 2>&1
curl -s -X POST "${worker_url}/api/v1/chat/stream?tenant=${tenant}" \
  -H "Content-Type: application/json" -d "{\"session_id\":\"$SID\",\"tool\":\"chat\",\"text\":\"04111\"}" --max-time 20 | grep "done"
```

```json expected
{"message_contains": ["10 digit", "start with 04", "phone"]}
```

---

## Phase 4: Infrastructure

**Intent:** Verify supporting endpoints remain healthy.

### 4.1 Dashboard

```http exec
curl -s -o /dev/null -w "%{http_code}" "${worker_url}/dashboard"
```

```json expected
{"status_code": "200"}
```

### 4.2 Health

```http exec
curl -s "${worker_url}/healthz"
```

```json expected
{"status": "ok"}
```

---

## Output

```json expected
{
  "test_summary": "ALL_TESTS_PASSED",
  "exit_code": 0
}
```

---

## Failure Handling

On ANY failure:
1. **STOP** execution immediately
2. **OUTPUT** the failed step and actual vs expected values
3. Do NOT retry, recover, or improvise
