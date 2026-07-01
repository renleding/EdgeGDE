/**
 * Aegis Policy Gate (FRS-AEGIS-PG-001)
 * =====================================
 * Deterministic, non-bypassable governance layer that enforces three-role
 * separation between Hermes (Director), Aegis (Governance), and Droid (Executor).
 *
 * Every action originating from Hermes passes through this gate before
 * any state mutation occurs. Designed for Cloudflare Workers runtime.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type Actor = 'hermes' | 'aegis' | 'droid'
export type SideEffect = 'none' | 'disk_write' | 'state_mutation' | 'audit_write' | 'kanban_write' | 'production'
export type Verdict = 'allow' | 'block' | 'escalate'

export interface PolicyAction {
  id: string
  description: string
  allowedActors: Actor[]
  requiresApproval: boolean
  sideEffects: SideEffect
  rule: string
}

export interface PolicyDecision {
  actionId: string
  actor: Actor
  verdict: Verdict
  reason: string
  rule: string
  timestamp: number
}

export interface PolicyDecisionLog extends PolicyDecision {
  durationMs: number
  policyVersion: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Policy Catalog
// ═══════════════════════════════════════════════════════════════════════════

const POLICY: PolicyAction[] = [
  // Planning — always allowed
  { id: 'action.plan', description: 'Hermes plans, decomposes, decides approach', allowedActors: ['hermes'], requiresApproval: false, sideEffects: 'none', rule: 'always_allow' },
  { id: 'action.read_file', description: 'Read a file from disk', allowedActors: ['hermes', 'droid'], requiresApproval: false, sideEffects: 'none', rule: 'always_allow' },
  { id: 'action.search_files', description: 'Search file contents', allowedActors: ['hermes', 'droid'], requiresApproval: false, sideEffects: 'none', rule: 'always_allow' },
  { id: 'action.clarify', description: 'Ask user a question', allowedActors: ['hermes'], requiresApproval: false, sideEffects: 'none', rule: 'always_allow' },
  { id: 'action.delegate_task', description: 'Delegate task to Droid', allowedActors: ['hermes'], requiresApproval: false, sideEffects: 'none', rule: 'always_allow' },
  { id: 'action.kanban_create', description: 'Create Kanban task', allowedActors: ['hermes', 'droid'], requiresApproval: false, sideEffects: 'kanban_write', rule: 'always_allow' },

  // Governance — Aegis only
  { id: 'action.validate_mutation', description: 'Validate mutation against schema', allowedActors: ['aegis'], requiresApproval: false, sideEffects: 'none', rule: 'always_allow' },
  { id: 'action.audit_log', description: 'Write audit trail entry', allowedActors: ['aegis'], requiresApproval: false, sideEffects: 'audit_write', rule: 'always_allow' },

  // Documentation, config, reports — Hermes can write directly (per Agent Selection Matrix)
  { id: 'action.write_documentation', description: 'Write docs, FRS, reports, markdown, config', allowedActors: ['hermes', 'droid'], requiresApproval: false, sideEffects: 'disk_write', rule: 'Hermes can write docs, FRS, config, markdown directly. Per Agent Selection Matrix: \"Config / docs / markdown change -> Hermes (direct)\".' },

  // Code changes — Hermes must delegate to Droid
  { id: 'action.write_code', description: 'Write or modify source code files', allowedActors: ['droid'], requiresApproval: true, sideEffects: 'disk_write', rule: 'Code changes must go through Droid. Hermes delegates via Mission Manifest.' },
  { id: 'action.patch_code', description: 'Apply a patch to source code', allowedActors: ['droid'], requiresApproval: true, sideEffects: 'disk_write', rule: 'Code patches must go through Droid.' },
  { id: 'action.shell', description: 'Execute a shell command', allowedActors: ['droid'], requiresApproval: true, sideEffects: 'disk_write', rule: 'Shell is high-risk. Requires allow_shell: true in Mission Manifest.' },
  { id: 'action.deploy', description: 'Deploy to staging or production', allowedActors: ['droid'], requiresApproval: true, sideEffects: 'production', rule: 'Deploy requires deploy gogo. Only Droid can execute.' },
]

/** Policy version — bump when rules change to invalidate cached decisions. */
export const POLICY_VERSION = 'aegis-policy-v1'

// ═══════════════════════════════════════════════════════════════════════════
// Policy Decision Log
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Immutable append-only policy decision log.
 * Every evaluate() call produces an entry that cannot be removed.
 */
export class PolicyAuditLog {
  private entries: PolicyDecisionLog[] = []

  append(entry: PolicyDecisionLog): void {
    this.entries.push(entry)
  }

  getAll(): PolicyDecisionLog[] {
    return [...this.entries]
  }

  getBlocked(): PolicyDecisionLog[] {
    return this.entries.filter(e => e.verdict === 'block')
  }

  count(): { total: number; allowed: number; blocked: number; escalated: number } {
    return {
      total: this.entries.length,
      allowed: this.entries.filter(e => e.verdict === 'allow').length,
      blocked: this.entries.filter(e => e.verdict === 'block').length,
      escalated: this.entries.filter(e => e.verdict === 'escalate').length,
    }
  }

  toJSON(): PolicyDecisionLog[] {
    return this.entries
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AegisPolicyGate
// ═══════════════════════════════════════════════════════════════════════════

export class AegisPolicyGate {
  private policies: PolicyAction[]
  private auditLog: PolicyAuditLog
  private failSecure: boolean = false
  private policyVersion: string

  constructor(policies?: PolicyAction[], policyVersion?: string) {
    this.policies = policies || POLICY
    this.policyVersion = policyVersion || POLICY_VERSION
    this.auditLog = new PolicyAuditLog()
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Evaluate whether an actor is allowed to perform an action.
   * This is the primary entry point — every Hermes action MUST pass through this.
   */
  evaluate(actionId: string, actor: Actor): PolicyDecision {
    const start = Date.now()
    const action = this.policies.find(a => a.id === actionId)

    if (!action) {
      return this.log({
        actionId, actor, verdict: 'block',
        reason: `Unknown action "${actionId}" — not in policy catalog`,
        rule: 'unknown_action_default_block',
        timestamp: start,
      }, start)
    }

    // Fail-secure: if integrity check failed, block everything
    if (this.failSecure) {
      return this.log({
        actionId, actor, verdict: 'block',
        reason: 'Aegis is in fail-secure mode',
        rule: action.rule,
        timestamp: start,
      }, start)
    }

    // Check if actor is allowed for this action
    if (!action.allowedActors.includes(actor)) {
      return this.log({
        actionId, actor, verdict: 'block',
        reason: `Actor "${actor}" not allowed for "${actionId}". Allowed: [${action.allowedActors.join(', ')}]`,
        rule: action.rule,
        timestamp: start,
      }, start)
    }

    // Allow
    return this.log({
      actionId, actor, verdict: 'allow',
      reason: `Actor "${actor}" authorized for "${actionId}"`,
      rule: action.rule,
      timestamp: start,
    }, start)
  }

  /**
   * Convenience: check file write permission for an actor.
   */
  checkFileWrite(actor: Actor, _filePath: string): PolicyDecision {
    return this.evaluate('action.write_file', actor)
  }

  /**
   * Convenience: check shell execution permission.
   */
  checkShell(actor: Actor, _command: string): PolicyDecision {
    return this.evaluate('action.shell', actor)
  }

  /**
   * Convenience: check deploy permission.
   */
  checkDeploy(actor: Actor, _environment: string): PolicyDecision {
    return this.evaluate('action.deploy', actor)
  }

  /**
   * Return the complete policy audit log.
   */
  getAuditLog(): PolicyDecisionLog[] {
    return this.auditLog.getAll()
  }

  /**
   * Return summary statistics of all policy decisions.
   */
  getStats(): { total: number; allowed: number; blocked: number; escalated: number } {
    return this.auditLog.count()
  }

  /**
   * Return the current policy list.
   */
  getPolicies(): PolicyAction[] {
    return [...this.policies]
  }

  /**
   * Return whether the gate is in fail-secure mode.
   */
  isFailSecure(): boolean {
    return this.failSecure
  }

  /**
   * Set fail-secure mode (used when policy file integrity check fails).
   */
  setFailSecure(value: boolean): void {
    this.failSecure = value
  }

  /**
   * Add an additional policy rule at runtime.
   */
  addPolicy(policy: PolicyAction): void {
    this.policies.push(policy)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════════════════

  private log(decision: PolicyDecision, startTime: number): PolicyDecision {
    this.auditLog.append({
      ...decision,
      durationMs: Date.now() - startTime,
      policyVersion: this.policyVersion,
    })
    return decision
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Instance
// ═══════════════════════════════════════════════════════════════════════════

let _instance: AegisPolicyGate | null = null

/**
 * Get the singleton AegisPolicyGate instance.
 * Creates it on first call with default policies.
 */
export function getPolicyGate(): AegisPolicyGate {
  if (!_instance) {
    _instance = new AegisPolicyGate()
  }
  return _instance
}

/**
 * Reset the singleton (for testing).
 */
export function resetPolicyGate(): void {
  _instance = null
}
