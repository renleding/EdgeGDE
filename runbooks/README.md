# EdgeGDE — Execution Runbooks

> Agent-executable, versioned procedural documents.
> Every runbook is both human-readable and machine-executable.

## Convention

- One `.md` file per procedure
- YAML frontmatter with all variables
- Phase-based structure
- Every execution step has a verification step
- Zero ambiguity — no implicit assumptions
- Idempotent where possible (UPSERT over INSERT)
- Versioned via git — bump frontmatter `version` field on changes

## Runbooks

| File | Purpose |
|---|---|
| [TENANT_ONBOARDING.md](./TENANT_ONBOARDING.md) | Create a new tenant from a blueprint |
| *(future)* UPGRADE_PACK.md | Apply a pack upgrade to a tenant |
| *(future)* INCIDENT_RECOVERY.md | Recover from upgrade failure or data loss |
| *(future)* TENANT_DECOMMISSION.md | Remove a tenant and clean up resources |
