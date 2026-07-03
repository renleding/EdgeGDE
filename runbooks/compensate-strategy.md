# Compensate Strategy — EdgeGDE Saga Operations

**Status:** Documented — NOT YET IMPLEMENTED in route handlers  
**Target:** Wire `tools/saga.py` (or equivalent JS Saga engine) into each Hono route handler  
**Reference:** `tools/saga.py`, `docs/TAMPER-PROOF-AUDIT-SPEC.md`

---

## Overview

Each route handler that mutates state should declare a Saga mission with compensate operations.
This ensures that if a multi-step request fails partway through, all side effects are rolled back.

The Saga engine from `tools/saga.py` provides:
- Task-level compensate definitions
- Reverse-order compensation on failure
- Checkpoint-based rollback
- Audit logging of compensation events

## Route Compensate Stubs

### 1. Lead Capture (`POST /api/v1/chat/stream`)

| Operation | Compensate |
|-----------|-----------|
| `lead.create` | `lead.delete(id)` — mark lead as deleted in D1 |
| `field.append` | `field.remove(sessionId, fieldIndex)` — revert to prior field state |
| `score.update` | `score.restore(sessionId, previousScore)` — restore previous score |
| `kv.cache` | `kv.delete(key)` — remove cached lead snapshot |

**Implementation notes:**
- Session state is in Durable Object (AUDIT_LEDGER) — compensate via DO method call
- D1 lead rows can be soft-deleted (`deleted_at = NOW()`)
- Chat history stream events cannot be retracted — compensate by adding a "corrected" event

### 2. Site Publish (`POST /api/sites/publish`)

| Operation | Compensate |
|-----------|-----------|
| `kv.put(site)` | `kv.delete(siteKey)` — remove published site data |
| `cdn.purge` | `cdn.revert(purgeId)` — CDN cache restore |
| `dns.record` | `dns.delete(recordId)` — remove DNS entry |

**Implementation notes:**
- Sites are stored in TENANT_KV — compensate is a simple delete
- CDN purge is fire-and-forget; compensate via a second purge request
- DNS operations need the DNS provider's revert API

### 3. Canvas Add Node (`POST /pwa-canvas/api/proposals`)

| Operation | Compensate |
|-----------|-----------|
| `proposal.create` | `proposal.reject(id)` — mark proposal as rejected |
| `object.add` | `object.remove(id)` — remove canvas object from state |
| `draft.save` | `draft.restore(previousSnapshot)` — restore from IndexedDB snapshot |

**Implementation notes:**
- Canvas state is managed client-side + IndexedDB — server-side compensate is via proposal rejection
- Proposals carry an `expectedVersion` field for conflict detection
- KV stores the proposal index — compensate via index update

### 4. Calculator Insert (`POST /api/calculator/insert`)

| Operation | Compensate |
|-----------|-----------|
| `calculator.register` | `calculator.unregister(id)` — remove from registry |
| `kv.metadata` | `kv.delete(metadataKey)` — remove calculator metadata |
| `widget.render` | `widget.unrender(slotId)` — remove rendered widget |

**Implementation notes:**
- Calculator engine uses a registry pattern (`registerCalculator()` / `unregisterCalculator()`)
- Widget rendering is ephemeral (Vite dev) — no compensate needed outside production
- KV metadata is the only durable state

## Priority Order for Implementation

1. **Calculator insert** — simplest, isolated, least risk (few side effects)
2. **Lead capture** — most important (financial data; compensation prevents data corruption)
3. **Canvas proposals** — moderate complexity (client+server state)
4. **Site publish** — most complex (DNS, CDN, KV, multiple external systems)

## How to Implement

```typescript
// Pattern: wrap route logic in a Saga mission
import { createMission, executeMission } from '../lib/saga'

router.post('/lead/stream', async (c) => {
  const mission = createMission({
    tasks: [
      { id: 'create_lead', operation: 'lead.create', compensate: { operation: 'lead.delete' } },
      { id: 'field_update', operation: 'field.append', depends_on: ['create_lead'],
        compensate: { operation: 'field.remove' } },
    ]
  })
  return await executeMission(mission, c)
})
```

The Saga engine already exists in `tools/saga.py` (Python). A JS/TS port for the edge runtime is needed, OR the route handlers can call out to the Python Saga CLI via `exec()`.
