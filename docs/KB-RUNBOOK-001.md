# Known-Bug Registry Intake Runbook

**Document ID:** KB-RUNBOOK-001  \\
**Version:** 1.0.0  \\
**Status:** Active  \\
**Owner:** Compliance Workstream (kanban t_b1efe846)  \\
**Contract Reference:** IDD-016 §9, `packages/automation-bridge/schemas/error-codes.json`

---

## 1. Purpose

This runbook governs the lifecycle of entries in the Known-Bug Registry consumed by the Automation Bridge resolver (IDD-016 §9). The registry is authoritative at `apps/state-engine/salestrekker_rules.py` and mirrored in the resolver's `KNOWN_BUG_FLAGS` constant.

Every entry must pass through this process before being added to the contract.

---

## 2. Initial Registry (Contract v2.0.0 Freeze)

| Bug ID | Description | Workaround | Phase Applied |
|---|---|---|---|
| `radix_portal_block` | Radix portal overlay intercepts CDP mouse events on comboboxes, dialogs, and portalled elements. | Force `KEY` tier (OS-level key events bypass the overlay). | Resolution (`applied: true`) |
| `react_props_fallback` | Save/submit buttons lack `__reactProps$` in some Salestrekker builds; CDP click via React event system fails silently. | Use bubbling dispatch or direct `element.click()`. | Dispatch (`applied: false`, enforced by Action Engine) |
| `false_positive_save` | "Client profile updated" toast appears even when the save did not persist (network error, validation failure). | Require URL change or network proof; toast alone is not verification. | Verification (`applied: false`, enforced by Verification Engine) |

---

## 3. Entry Schema

Every registry entry MUST have these fields:

```yaml
bug_id: "snake_case_identifier"  # Unique, immutable
description: "Human-readable symptom and root cause"
workaround: "Actionable mitigation steps"
applies_when: "trigger_condition"  # portal | no_react_props | save_action | custom
applied_at_resolution: boolean      # true = resolver applies; false = later component
# Phase 3 extensions:
tier_override: "KEY" | null         # Forces Action Engine tier selection
dispatch_strategy: "bubble_or_direct" | null  # Overrides CDP click behavior
verification_mode: "strict" | null  # Enforces URL/network proof for saves
reason: "string" | null             # Required when applied_at_resolution=false
```

---

## 4. Intake Process

### 4.1 Discovery
1. **Observed failure** during Salestrekker automation (manual or CI).
2. **Root cause confirmed** via CDP logs, Action Journal, or Verification diff.
3. **Workaround validated** — the workaround must be reproducible and deterministic.

### 4.2 Proposal
Create a GitHub issue with:
- Title: `[KB-REGISTRY] <bug_id>`
- Template: `.github/issue_templates/kb-registry.yml` (to be created)
- Required fields from §3
- Link to failing mission log or CI run
- Before/after evidence (screenshots, HAR, state diff)

### 4.3 Review
- **Compliance owner** (t_b1efe846) reviews within 2 business days.
- **Hermes engineer** validates workaround integrates with resolver/ActionEngine/VerificationEngine.
- **Salestrekker SME** confirms the bug is not a transient flake.

### 4.4 Approval & Merge
- Approved by Compliance owner + Hermes engineer.
- PR adds entry to:
  1. `apps/state-engine/salestrekker_rules.py` (canonical source)
  2. `packages/automation-bridge/schemas/error-codes.json` (if new error code)
  3. Resolver `KNOWN_BUG_FLAGS` constant (mirrored at deploy)
- Contract version: **minor bump** (additive optional field = minor; new bug id = minor).
- CI gate `automation-bridge-contract` validates the updated registry.

### 4.5 Deprecation
When a Salestrekker fix eliminates the bug:
1. Mark entry `deprecated: true` with `deprecated_at` and `fixed_in_build`.
2. Keep in registry for 2 contract versions (replay safety).
3. Remove on next major bump.

---

## 5. CI Gates Enforcing Registry Compliance

| Gate | Job | Check |
|---|---|---|
| Schema validity | `automation-bridge-contract` | `validate_examples.py` passes |
| Flag presence | `automation-bridge-contract` | Portal responses carry `radix_portal_block` |
| Verification verdict | `automation-bridge-contract` | Every `action_outcome` has `verification.verdict` |
| Error code registry | `automation-bridge-contract` | `error-codes.json` matches response/error schemas |

---

## 6. Adding a New Entry (Checklist)

- [ ] Issue created with `[KB-REGISTRY]` prefix
- [ ] Root cause documented with evidence
- [ ] Workaround tested in isolation
- [ ] Schema fields complete (§3)
- [ ] Reviewed by Compliance + Hermes + SME
- [ ] PR updates `salestrekker_rules.py` and resolver mirror
- [ ] Contract version bumped (minor)
- [ ] CI `automation-bridge-contract` passes
- [ ] Documentation updated (this runbook, IDD-016 §9 table)

---

## 7. Related Artifacts

| Artifact | Location |
|---|---|
| Canonical rule source | `apps/state-engine/salestrekker_rules.py` |
| Error code registry | `packages/automation-bridge/schemas/error-codes.json` |
| Resolver mirror | `apps/state-engine/automation_bridge_resolver.py` (KNOWN_BUG_FLAGS) |
| Contract doc | `docs/IDD-016-automation-bridge-v1.md` §9 |
| CI gate | `.github/workflows/ci.yml` job `automation-bridge-contract` |
| OpenSpec change | `openspec/changes/automation-bridge-contract/` |

---

## 8. Change Log

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-11-01 | Initial runbook for Phase 4 governance |