---
name: EdgeGDE_Agent_Config_Inheritance_v1_0_0_Functional
version: "1.0.0"
status: draft_functional_spec
owner: Hermes / Aegis / EdgeGDE
created_at: "2026-06-19"
runtime_target: apps/edge-runtime
related_specs:
  - docs/telemetry-analytics-v1.0.0-functional.md
---

# EdgeGDE Agent Config Inheritance and Triggered Updates — Functional Specification v1.0.0

## 0. Objective

EdgeGDE chat agents need deterministic configuration management for high-volume tenant rollout.

This spec defines:

1. triggered config rebuilds after new KB information or file uploads are approved;
2. config duplication so many chat agents can be created from one known-good configuration;
3. parent/child configuration inheritance where parent updates automatically refresh child effective configs;
4. admin controls for parent toggle, child toggle, parent selection, child count, and child list by name.

The runtime must continue reading `tenant:{tenantId}:chat:config`, but that key must represent the effective merged config for the tenant.

## 1. Core Model

### Independent Agent

An independent agent owns all config directly.

KV keys:

- `tenant:{tenantId}:chat:config`
- `tenant:{tenantId}:kb:{topic}`
- `tenant:{tenantId}:layout:latest`
- `tenant:{tenantId}:agent:profile`

Rules remain tenant-scoped in D1:

- `rules.tenant_id = {tenantId}`

### Cloned Independent Agent

A cloned independent agent starts as a deep copy of another agent.

Clone copies:

- chat config
- KB entries for configured topics
- layout
- rules when DB is available
- agent profile defaults

Clone changes identity fields:

- tenant ID/slug
- agent name
- objective
- UI title/greeting

Parent link:

- `parentTenantId = null`
- `childInheritanceEnabled = false`

### Parent/Child Agent

A child agent inherits from a parent and stores local overrides.

Effective config:

```text
effective = merge(parentEffectiveConfig, childOverrides)
```

Child overrides win for explicitly overridden fields.

Parent-owned fields continue to update children when the parent is changed and parent inheritance is enabled.

## 2. Profile Schema

Add KV profile key:

```text
tenant:{tenantId}:agent:profile
```

Schema:

```ts
interface AgentProfile {
  tenantId: string
  name: string
  parentInheritanceEnabled: boolean
  childInheritanceEnabled: boolean
  parentTenantId?: string | null
  updatedAt: number
  sourceRef: string
}
```

Default independent profile:

```json
{
  "tenantId": "alpha-broker-01",
  "name": "Alpha Broker 01",
  "parentInheritanceEnabled": false,
  "childInheritanceEnabled": false,
  "parentTenantId": null,
  "updatedAt": 1710000000000,
  "sourceRef": "manual"
}
```

Child profile:

```json
{
  "tenantId": "alpha_broker_02",
  "name": "Alpha Broker 02",
  "parentInheritanceEnabled": false,
  "childInheritanceEnabled": true,
  "parentTenantId": "alpha-broker-01",
  "updatedAt": 1710000000000,
  "sourceRef": "parent:alpha-broker-01"
}
```

## 3. Config Keys

Add:

```text
tenant:{tenantId}:config:overrides
tenant:{tenantId}:config:effective
```

Runtime key remains:

```text
tenant:{tenantId}:chat:config
```

Invariant:

```text
tenant:{tenantId}:chat:config == effective merged config
```

For independent agents, effective equals local chat config.

For child agents, effective equals parent effective config merged with child overrides.

## 4. Parent Toggle

Admin parent panel must include:

- toggle: `Parent inheritance enabled`
- child count
- children list by name

When ON:

- tenant can be selected as a parent by children;
- parent KB/rules/config changes may propagate to active children;
- children list is visible.

When OFF:

- tenant stops publishing parent updates;
- children remain linked but stop receiving updates;
- children keep their last effective config;
- children list remains visible with status `inheritance paused`.

Parent toggle controls propagation, not tenant existence.

## 5. Child Toggle

Admin child panel must include:

- toggle: `Use parent config`
- parent dropdown when ON

When ON:

- parent dropdown appears;
- dropdown lists only tenants where `parentInheritanceEnabled = true`;
- parent selection is required;
- child effective config is rebuilt from parent + overrides.

When OFF:

- parent dropdown is hidden;
- parent link is cleared;
- current effective config is snapshotted into local chat config;
- child becomes independent.

Toggling child OFF must not delete child data.

## 6. Triggered Update Events

New file upload or URL ingestion creates pending KB only.

Approved KB triggers config rebuild.

Event flow:

```text
upload/url/file
  -> kb_pending:{topic}
  -> human/policy approve
  -> kb:{topic}
  -> rebuild tenant effective config
  -> if parentInheritanceEnabled=true, rebuild active children
```

Trigger sources:

- KB topic approved
- KB topic rejected
- parent chat config changed
- parent rules changed
- parent layout promoted
- child override changed
- parent toggle changed
- child toggle changed
- child parent changed

Approval gate:

- uploads do not change active chat config directly;
- only approved KB participates in active config.

## 7. Merge Rules

Parent wins for inherited base config:

- base fields
- priorityOrder
- shared KB topics
- shared compliance
- shared policy rules
- shared objective template

Child wins for overrides:

- tenant name
- UI title
- UI greeting
- color accent
- child-local KB
- child-local rules
- child-local layout
- explicitly overridden fields
- explicitly overridden priorityOrder
- explicitly overridden KB topics

If a child overrides a parent-owned field, parent updates must not overwrite that child override.

## 8. Admin API Contract

New router:

```text
/admin/config
```

Endpoints:

```text
GET  /admin/config?tenant={tenantId}&token={token}
GET  /admin/config/parents?tenant={tenantId}&token={token}
GET  /admin/config/children?parent={tenantId}&token={token}
POST /admin/config/parent-toggle?tenant={tenantId}&enabled={true|false}&token={token}
POST /admin/config/child-toggle?tenant={tenantId}&enabled={true|false}&parent={parentTenantId}&token={token}
POST /admin/config/clone?sourceTenant={tenantId}&tenant={tenantId}&name={name}&token={token}
POST /admin/config/rebuild?tenant={tenantId}&token={token}
POST /admin/config/propagate?parent={tenantId}&token={token}
```

Response should be HTMX-friendly HTML for admin pages.

## 9. Runtime Behavior

Runtime must not compute inheritance on every request.

Runtime reads:

```text
tenant:{tenantId}:chat:config
```

Admin/config service writes the effective config into that key.

This keeps runtime deterministic and simple.

## 10. Commands

Local dev:

```bash
cd apps/edge-runtime
NODE_ENV=development npm run dev -- --ip 0.0.0.0 --port 8787 --var NODE_ENV:development --var ADMIN_API_TOKEN:dev-token
```

Typecheck:

```bash
cd apps/edge-runtime
npm run typecheck
```

Feature test:

```bash
cd apps/edge-runtime
npx tsx tests/config-inheritance.test.ts
```

Local smoke:

```bash
curl http://localhost:8787/healthz
curl 'http://localhost:8787/admin/config?tenant=alpha_broker_02&token=dev-token'
curl 'http://localhost:8787/admin/drift?tenant=alpha_broker_02&token=dev-token'
curl 'http://localhost:8787/embed/chat?tenant=alpha_broker_02'
curl 'http://localhost:8787/sites/alpha_broker_02'
```

## 11. Testing Strategy

Unit tests:

- profile defaults
- parent toggle list filtering
- child toggle parent selection validation
- effective config merge
- child override preservation
- clone identity rewrite
- clone KB copy by topic
- parent propagation only when both parent and child toggles are enabled

Integration tests:

- create `alpha_broker_02` from `alpha-broker-01`
- set parent toggle ON for `alpha-broker-01`
- set child toggle ON for `alpha_broker_02` with parent `alpha-broker-01`
- approve KB topic and verify child config rebuilds
- compare `01` and `02` endpoints

Endpoint tests:

- `/admin/config`
- `/admin/config/parents`
- `/admin/config/children`
- `/admin/config/clone`
- `/admin/config/parent-toggle`
- `/admin/config/child-toggle`
- `/admin/config/rebuild`
- `/admin/config/propagate`

## 12. Success Criteria

- Parent config toggle exists and persists.
- Child config toggle exists and persists.
- Parent selection list only includes active parents.
- Parent page shows child count and child names.
- Child effective config is rebuilt when parent config changes.
- Child overrides survive parent updates.
- KB approval triggers tenant rebuild and child propagation.
- Clone creates a new tenant config with copied KB/topics/layout/rules where available.
- Runtime continues reading `tenant:{tenantId}:chat:config`.
- `alpha_broker_02` can be tested side-by-side with `alpha-broker-01`.

## 13. Boundaries

Always:

- validate tenant IDs;
- preserve child overrides;
- include audit/source metadata;
- keep runtime reads simple;
- verify effective config after writes.

Ask first:

- changing production deployment;
- changing auth model;
- changing D1 schema;
- copying production tenant data.

Never:

- store tokens in config;
- allow unapproved uploads to change active chat config;
- overwrite child overrides from parent updates;
- delete child data when detaching from parent.

## 14. Open Questions

- Should parent propagation be synchronous in admin requests or queued?
- Should detached children retain historical parent metadata?
- Should KB inheritance be by reference or copied for scale?
- Should child overrides include rules, layout, or only chat config?
