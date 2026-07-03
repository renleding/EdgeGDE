# Functional Requirements Specification (FRS): Aegis Policy Gate

**Document ID:** FRS-AEGIS-PG-001  
**Version:** 1.0  
**Status:** Draft  
**Author:** Systems Architecture Team  
**Date:** 2024-Q3  

---

## 1. Objective

The **Aegis Policy Gate (APG)** is a deterministic, non-bypassable governance layer that enforces strict three-role separation between the EdgeGDE kernel agents:

| Role | Agent | Responsibility |
|------|-------|----------------|
| Director | Hermes | Plan decomposition, approach selection, task orchestration |
| Governor | Aegis | Policy validation, mutation gatekeeping, audit trail maintenance |
| Executor | Droid | Constrained execution (read/write/shell via `ornith:9b`) |

**Primary Objective:** Prevent Hermes from executing actions directly or bypassing the governance layer. Every action originating from Hermes—whether delegated to Droid or attempted as a direct operation—must pass through Aegis for validation before any state mutation occurs.

---

## 2. Current Baseline

### 2.1 Existing Capabilities (Inherited)

The following components are already implemented and operational:

| Component | Functionality |
|-----------|---------------|
| `canvas-schemas.ts` | Zod schemas for 10 mutation types (`Node`, `CanvasDocument`, `AgentCommand`) |
| `aegis-gate.ts` | `AegisMutationGate` class with `validate()`, `validateBatch()`, CoT reasoning traces, checksums |
| `CanvasSession_DO` | Integration point where every mutation passes through `aegis.validate()` before `applyMutation()` |

**Supported Mutation Types:**
- `add_node`, `update_node`, `delete_node`, `move_node`
- `transition_agent_state`, `create_proposal`, `approve/reject_proposal`
- `rollback_to_point`, `link_workspaces`

### 2.2 Identified Gaps

| Gap | Impact |
|-----|--------|
| No enforcement of Agent Selection Matrix (ASM) compliance | Hermes may delegate tasks it should not execute directly |
| No interception of direct Hermes actions (write_file, patch, terminal) | Three-role separation is advisory only |
| `AGENTS.md` contract has no runtime enforcement mechanism | Policy violations go undetected |
| No audit trail for policy decisions | Cannot trace governance history |
| Rules are not versioned or auditable | Drift detection impossible |

---

## 3. Proposed Aegis Policy Gate Architecture

### 3.1 System Boundary

```
┌─────────────────────────────────────────────────────────┐
│                    EdgeGDE Kernel                         │
│                                                          │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ Hermes   │───▶│ Aegis Policy │───▶│ Droid        │   │
│  │ (Director)│   │     Gate      │   │ (Executor)    │   │
│  └──────────┘    └──────┬───────┘   └──────┬────────┘   │
│                         │                  │              │
│                    [Validate]        [Execute]           │
│                    [Audit Log]       [Constrained Ops]   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Gate Components

| Component | Responsibility |
|-----------|---------------|
| `APG_Interceptor` | Entry point; captures all Hermes action intents before execution |
| `Policy_Engine` | Evaluates actions against ASM rules + three-role separation constraints |
| `Rule_Store` | Versioned, auditable policy rule repository (immutable once published) |
| `Audit_Tail` | Append-only log of all policy decisions with cryptographic signatures |
| `Bypass_Detector` | Monitors for attempts to disable/modify the gate itself |

### 3.3 Data Flow

```
Hermes Intent ──▶ APG_Interceptor ──▶ Policy_Engine
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Rule_Store     Bypass_Detector    Audit_Tail
              (Versioned)   (Integrity Check)  (Append-Only)
```

---

## 4. Policy Rules Catalog

### 4.1 Three-Role Separation Rules (Mandatory — Always Enforced)

| Rule ID | Description | Action | Severity |
|---------|-------------|--------|----------|
| `R01` | Hermes may not write files directly to disk | Block | Critical |
| `R02` | Hermes may not execute shell/terminal commands directly | Block | Critical |
| `R03` | Hermes may not patch source code without Droid mediation | Block | Critical |
| `R04` | All state mutations must pass through Aegis before applyMutation() | Enforce | Critical |
| `R05` | Hermes may not transition its own agent_state directly | Block | High |

### 4.2 Agent Selection Matrix Rules (Conditional — Based on Task Classification)

| Rule ID | Description | Action | Severity |
|---------|-------------|--------|----------|
| `R10` | Simple read operations → Hermes may execute directly (no Droid needed) | Allow | Low |
| `R11` | Complex write/transform operations → Must delegate to Droid | Enforce | High |
| `R12` | State transitions → Must route through Aegis governance | Enforce | High |
| `R13` | Proposal creation/approval/rejection → Must use proposal workflow | Enforce | Medium |

### 4.3 Bypass Prevention Rules (Always Active)

| Rule ID | Description | Action | Severity |
|---------|-------------|--------|----------|
| `B01` | Gate integrity check: verify gate module hash matches published version | Block if mismatch | Critical |
| `B02` | Monitor for Hermes attempts to modify gate configuration | Alert + Block | Critical |
| `B03` | Detect and block any action that references a disabled gate state | Block | Critical |

### 4.4 Allowed Actions (Explicit Whitelist)

| Rule ID | Description | Action | Severity |
|---------|-------------|--------|----------|
| `A01` | Hermes planning/decomposition (read-only canvas operations) | Allow | Low |
| `A02` | Droid execution of validated mutations via Aegis | Allow | Low |
| `A03` | Audit log reads by authorized governance roles | Allow | Low |

---

## 5. Integration Points

### 5.1 Pipeline Insertion Points

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ Hermes      │────▶│ APG_Interceptor │────▶│ Policy_Engine │
│ Action Intent│    │ (Entry Point)  │    │ (Evaluation)   │
└─────────────┘     └──────────────┘     └──────┬────────┘
                                                │
                    ┌──────────────┐            ▼
                    │ Droid        │    ┌──────────────┐
                    │ Execution    │◀──│ Audit_Tail   │
                    │ (Constrained)│    │ (Append-Only)│
                    └──────────────┘    └──────────────┘
```

### 5.2 Integration Contracts

| Contract | Direction | Protocol |
|----------|-----------|----------|
| `Hermes → APG_Interceptor` | Hermes to Gate | Structured intent payload (JSON) with action metadata |
| `APG_Interceptor → Policy_Engine` | Internal | Synchronous evaluation call |
| `Policy_Engine → Audit_Tail` | Gate to Log | Append-only write, cryptographically signed |
| `Droid → APG_Interceptor` | Executor to Gate (feedback) | Execution result report for audit completeness |

### 5.3 Mutation Flow Enforcement

```
CanvasSession_DO.applyMutation()
    │
    ▼
AegisMutationGate.validate() [Existing]
    │
    ▼
APG_Interceptor.checkIntent() [NEW — pre-validate check]
    │
    ├── Block → Reject with reason + audit log entry
    └── Allow → Proceed to AegisMutationGate.validate()
```

---

## 6. Enforcement Mechanism (Non-Bypassable)

### 6.1 Hardcoded Enforcement Strategy

The APG is enforced through **three layers of defense**:

| Layer | Mechanism | Bypass Difficulty |
|-------|-----------|-------------------|
| **Layer 1: Structural** | Gate is integrated into `CanvasSession_DO` as a mandatory pre-check before any mutation | Requires kernel-level modification to bypass |
| **Layer 2: Runtime** | Every Hermes action intent is intercepted and evaluated synchronously | Requires Hermes agent rewrite to bypass |
| **Layer 3: Integrity** | Gate module hash is verified against published version; tampering triggers automatic block + alert | Requires cryptographic compromise |

### 6.2 Non-Bypass Guarantee

```
IF (gate_hash != published_hash) THEN block_all_actions() AND alert_governance()
IF (Hermes_intent.action_type NOT IN allowed_whitelist) THEN block_with_reason() AND audit_log()
IF (any_state_mutation_without_aegis_validation) THEN reject() AND rollback_if_possible()
```

### 6.3 Gate Integrity Protocol

| Check | Frequency | Consequence of Failure |
|-------|-----------|----------------------|
| Module hash verification | Every action invocation | Immediate block + governance alert |
| Configuration drift detection | Continuous (on every intent) | Block + audit trail entry |
| Bypass attempt monitoring | Real-time | Alert to Aegis Director role |

---

## 7. Acceptance Criteria

### 7.1 Functional Requirements

| ID | Requirement | Verification Method |
|----|-------------|---------------------|
| `AC-01` | All Hermes actions are intercepted before execution or Droid dispatch | Unit test: inject action, verify interception |
| `AC-02` | Actions violating three-role separation are blocked with clear reason codes | Integration test: attempt direct write, expect block |
| `AC-03` | Validated actions proceed to AegisMutationGate for mutation validation | End-to-end test: valid intent → gate → apply |
| `AC-04` | All policy decisions (approve/reject) are logged to audit trail with timestamps and signatures | Audit log inspection test |
| `AC-05` | Same action input always produces same policy decision (deterministic) | Determinism test: identical inputs → identical outputs |
| `AC-06` | Gate cannot be disabled or ignored by Hermes without kernel-level changes | Penetration test: attempt gate disable, expect block |
| `AC-07` | Policy rules are versioned and auditable (immutable once published) | Version control + audit trail verification |

### 7.2 Performance Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| `PR-01` | Gate evaluation latency per action intent | < 50ms p95 |
| `PR-02` | Audit log write throughput | ≥ 1,000 entries/sec |
| `PR-03` | No degradation to existing mutation pipeline performance | Baseline comparison within ±5% |

### 7.3 Security Requirements

| ID | Requirement | Verification |
|----|-------------|--------------|
| `SR-01` | Gate integrity hash matches published version on every invocation | Hash verification test |
| `SR-02` | Audit log is append-only and tamper-evident | Cryptographic signature validation |
| `SR-03` | Bypass attempts are detected and logged within 1 second | Invasive attempt simulation |

---

## 8. Implementation Phases

### Phase 1: Foundation (Weeks 1–2)

| Task | Deliverable |
|------|-------------|
| Define policy rule schema (JSON Schema for rules) | `policy-rules-schema.json` |
| Implement `APG_Interceptor` class | Source code + unit tests |
| Build `Rule_Store` with versioning logic | Versioned rule storage + API |

### Phase 2: Integration (Weeks 3–4)

| Task | Deliverable |
|------|-------------|
| Integrate APG into `CanvasSession_DO` pipeline | Modified `applyMutation()` flow |
| Implement audit trail with cryptographic signing | `Audit_Tail` service + schema |
| Build bypass detection module | `Bypass_Detector` class |

### Phase 3: Hardening (Weeks 5–6)

| Task | Deliverable |
|------|-------------|
| Determinism verification suite | Test harness for identical-input testing |
| Performance benchmarking | Baseline comparison report |
| Security penetration testing | Threat model + findings document |

### Phase 4: Deployment & Monitoring (Weeks 7–8)

| Task | Deliverable |
|------|-------------|
| Production deployment with canary rollout | Deployment runbook |
| Governance dashboard for policy decisions | Real-time monitoring UI |
| Runbook for rule versioning and updates | Operations documentation |

---

## 9. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **R1: Hermes agent rewrite to bypass gate** | Critical governance failure | Low (requires kernel-level changes) | Layered enforcement; structural integration makes this impractical without full kernel rebuild |
| **R2: Performance degradation under load** | System latency increase | Medium | Benchmarking in Phase 3; optimize rule evaluation if needed |
| **R3: Rule versioning complexity** | Operational overhead for governance team | Low | Automated version management with clear promotion workflow |
| **R4: Edge cases in ASM classification** | Legitimate actions incorrectly blocked | Medium | Maintain allowlist + denylist; human-in-the-loop escalation path for disputed blocks |
| **R5: Audit log storage growth** | Storage capacity concerns over time | Low | Log compaction strategy; retention policy with configurable TTL |
| **R6: Rule conflicts or contradictions** | Inconsistent enforcement decisions | Low | Formal rule validation at versioning time; conflict detection in `Rule_Store` |

---

## Appendix A: Policy Decision Payload Schema

```json
{
  "decision_id": "uuid",
  "timestamp": "ISO-8601",
  "action_intent": {
    "source_agent": "hermes",
    "action_type": "string",
    "payload_hash": "sha256",
    "target_resource": "string"
  },
  "policy_evaluation": {
    "rules_applied": ["R01", "R04"],
    "decision": "approve | reject | escalate",
    "reason_codes": ["RC-001"],
    "deterministic_seed": "sha256(input)"
  },
  "audit_signature": "ed25519",
  "gate_version": "v1.0"
}
```

---

## Appendix B: Rule Versioning Protocol

| Field | Description |
|-------|-------------|
| `rule_version` | Semantic version (major.minor.patch) |
| `effective_date` | When rule becomes active |
| `retroactive_window` | Grace period for existing sessions to adapt |
| `superseded_by` | Reference to next version if applicable |
| `change_log` | Human-readable description of changes |

**Version Promotion Workflow:**
1. Governance team proposes rule change → draft in staging
2. Validation suite passes (determinism + performance) → approved
3. Published with new version number; old rules remain for existing sessions during retroactive window
4. After retroactive window closes, old rules are archived

---

## Appendix C: Escalation Matrix

| Condition | Action | Responsible Party |
|-----------|--------|-------------------|
| Legitimate action incorrectly blocked | Hermes escalates to Aegis Director via proposal workflow | Hermes → Aegis (proposal) |
| Rule conflict detected | Governance team reviews and resolves before next version | Aegis governance team |
| Bypass attempt confirmed | Immediate alert + full audit trail preservation | Automated detection → Aegis Director |

---

**End of Document**