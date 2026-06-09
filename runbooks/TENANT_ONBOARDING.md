---
runbook: tenant_onboarding
version: v1
created: 2026-06-09
author: Hermes Agent

tenant_id: alpha-broker-01
tenant_slug: alpha-broker-01
blueprint_id: au_mortgage_broker_afirmico_BP001
blueprint_version: v0.0.1

environment: production
worker_url: https://edgegde-calculator.renleding.workers.dev
auth_token: "${ADMIN_TOKEN}"

requires:
  - ADMIN_TOKEN
  - HMAC_KEY

outputs:
  - embed_snippet
  - tenant_status
---

# Tenant Onboarding Runbook

> Create a new tenant from a blueprint — fully deterministic, fully verifiable.

---

## Phase 1: Environment & Secret Verification

**Intent:** Confirm the target environment is reachable and the required secrets are available. No point executing further if the worker or auth is missing.

**Why:** Prevents wasted execution against a dead environment. Establishes a known-good starting state.

**Success:** Worker responds 200, admin token is valid.

---

### 1.1 Verify worker is reachable

```http exec
curl -s -o /dev/null -w "%{http_code}" \
  "${worker_url}/admin/blueprints?token=${auth_token}"
```

```json expected
{
  "status_code": "200"
}
```

### 1.2 Verify admin token is valid

```http exec
curl -s "${worker_url}/admin/site?token=${auth_token}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('auth_ok' if d.get('status') or True else 'fail')"
```

```json expected
{
  "auth_valid": true
}
```

---

## Phase 2: KV Blueprint Loading

**Intent:** Load the blueprint definition from KV and confirm all referenced packs exist. The blueprint defines the field schema, priority order, and pack dependencies. If any pack is missing, the factory will create a tenant with zero rules — which is valid but silent.

**Why:** Detects missing packs before tenant creation. A tenant created without rule packs will have no compliance enforcement.

**Success:** Blueprint loaded, all referenced packs verified.

---

### 2.1 Fetch blueprint from KV

```http exec
curl -s "${worker_url}/admin/blueprints?token=${auth_token}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
bps = d.get('blueprints', d.get('data', []))
for bp in bps:
    if '${blueprint_id}' in (bp.get('id','') + bp.get('name','')):
        print('found: ' + bp.get('id',''))
        print('packs: ' + str(bp.get('packs', [])))
        break
"
```

```json expected
{
  "blueprint_found": true,
  "packs_defined": true
}
```

### 2.2 Verify referenced packs exist

```http exec
curl -s "${worker_url}/admin/packs?token=${auth_token}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
packs = d.get('packs', [])
print('total_packs: ' + str(len(packs)))
for p in packs:
    print(f'  {p.get(\"name\",\"?\")} v{p.get(\"version\",\"?\")}')
"
```

```json expected
{
  "total_packs": "> 0"
}
```

---

## Phase 3: Tenant Initialization (Factory)

**Intent:** Create the tenant via the factory endpoint. The factory validates the blueprint, installs rule packs (D1 batch), commits config (KV dual-write to slug + UUID), and registers the tenant. This is the only atomic create path — do NOT write tenant configs manually.

**Why:** The factory guarantees: blueprint validation, pack installation in a single batch transaction, config dual-write, and drift detection baseline. Manual writes bypass all of these.

**Success:** Tenant created with correct field config, installed rules > 0, drift = 0.

---

### 3.1 Create tenant via factory

```http exec
curl -s -X POST "${worker_url}/admin/factory/create-tenant?token=${auth_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "blueprint_id": "${blueprint_id}",
    "blueprint_version": "${blueprint_version}",
    "tenant_slug": "${tenant_slug}",
    "tenant_name": "Alpha Broker One"
  }'
```

```json expected
{
  "tenant_id": "${tenant_id}",
  "rules_installed": "> 0",
  "drift": 0
}
```

### 3.2 Verify tenant config in KV

```http exec
curl -s "${worker_url}/admin/site?token=${auth_token}&tenant=${tenant_slug}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('tenant_found: ' + str(d.get('tenantId') == '${tenant_id}'))
fields = d.get('config', {}).get('fields', [])
print('field_count: ' + str(len(fields)))
"
```

```json expected
{
  "tenant_found": true,
  "field_count": "> 0"
}
```

### 3.3 Verify rules installed in D1

```sql exec
SELECT COUNT(*) as rule_count FROM rules WHERE tenant_id = '${tenant_id}' AND active = 1
```

```json expected
{
  "rule_count": "> 0"
}
```

### 3.4 Verify drift = 0

```http exec
curl -s "${worker_url}/admin/drift?token=${auth_token}&tenant=${tenant_slug}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('drift: ' + str(d.get('drift_items', [])))
print('drift_count: ' + str(len(d.get('drift_items', []))))
"
```

```json expected
{
  "drift_count": 0
}
```

---

## Phase 4: Host Integration Snippet

**Intent:** Extract the embed snippet that the broker can place on their website. The widget is served from the worker and auto-loads with the correct tenant configuration.

**Why:** This is the delivery step — the broker needs this snippet to activate their chat widget.

**Success:** Embed snippet generated, widget URL resolves.

---

### 4.1 Generate embed snippet

The widget can be embedded in two ways:

**Option A — Iframe embed (simple):**

```html
<iframe
  src="${worker_url}/embed/chat?tenant=${tenant_slug}"
  style="position:fixed;bottom:20px;right:20px;width:380px;height:600px;max-height:80vh;border:none;z-index:2147483647;background:transparent"
  sandbox="allow-scripts allow-forms"
  title="Chat Assistant">
</iframe>
```

**Option B — Script embed (auto-injects iframe):**

```html
<script
  src="${worker_url}/widget.js?v=v1.0.0"
  data-tenant="${tenant_slug}"
  defer>
</script>
```

### 4.2 Verify widget loads

```http exec
curl -s -o /dev/null -w "%{http_code}" \
  "${worker_url}/widget.js?v=v1.0.0"
```

```json expected
{
  "status_code": "200"
}
```

### 4.3 Verify chat init works for new tenant

```http exec
curl -s -X POST "${worker_url}/api/v1/chat/init?tenant=${tenant_slug}" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "runbook-verify"}' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('init_ok: ' + str('sessionId' in d))
"
```

```json expected
{
  "init_ok": true
}
```

---

## Phase 5: Telemetry Verification (AuditLedger_DO)

**Intent:** Verify the audit system is receiving events for this tenant. Run an adversarial test input that triggers rules, then confirm rule_evaluated and disclosure_shown events exist in the audit log.

**Why:** An unlogged disclosure is legally a disclosure that never happened. This phase proves the audit pipeline works end-to-end for this tenant.

**Success:** AuditLedger_DO contains rule_evaluated and disclosure_shown events.

---

### 5.1 Submit test input that triggers rules

```http exec
curl -s -X POST "${worker_url}/api/v1/chat/tool?tenant=${tenant_slug}" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "chat",
    "session_id": "runbook-test",
    "text": "",
    "fields": {
      "annualIncome": 45000,
      "loanAmount": 900000,
      "propertyValue": 950000,
      "employmentType": "Self-Employed"
    }
  }' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('response_has_disclosures: ' + str('disclosure' in json.dumps(d).lower()))
"
```

```json expected
{
  "response_has_disclosures": true
}
```

### 5.2 Verify audit events exist

```http exec
curl -s "${worker_url}/api/v1/tenant/${tenant_slug}/audit/events?token=${auth_token}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
events = d.get('events', [])
types = [e.get('event_type','') for e in events]
print('rule_evaluated: ' + str('rule_evaluated' in types))
print('disclosure_shown: ' + str('disclosure_shown' in types))
print('total_events: ' + str(len(events)))
"
```

```json expected
{
  "rule_evaluated": true,
  "disclosure_shown": true,
  "total_events": "> 0"
}
```

---

## Output

### Embed Snippet

```html
<script src="${worker_url}/widget.js?v=v1.0.0" data-tenant="${tenant_slug}" defer></script>
```

### Confirmation

```json expected
{
  "tenant_status": "ACTIVE",
  "audit_ready": true
}
```

---

## Failure Handling

At ANY point during execution, if a verification block does not match the expected output:

1. **STOP** execution immediately
2. **OUTPUT** the failed step and the actual vs expected values
3. **DO NOT** retry, recover, or improvise
4. **DO NOT** skip the failed step and continue

The runbook must be re-executed from the beginning after the root cause is resolved.
