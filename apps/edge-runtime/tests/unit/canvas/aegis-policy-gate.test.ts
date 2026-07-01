import { describe, it, expect, beforeEach } from 'vitest'
import { AegisPolicyGate, resetPolicyGate, getPolicyGate } from '../../../src/canvas/aegis-policy-gate'

describe('AegisPolicyGate', () => {
  beforeEach(() => {
    resetPolicyGate()
  })

  it('allows Hermes to plan and read files', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.plan', 'hermes').verdict).toBe('allow')
    expect(gate.evaluate('action.read_file', 'hermes').verdict).toBe('allow')
    expect(gate.evaluate('action.search_files', 'hermes').verdict).toBe('allow')
  })

  it('allows Droid to write code', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.write_code', 'droid').verdict).toBe('allow')
  })

  it('allows Hermes to write documentation directly', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.write_documentation', 'hermes').verdict).toBe('allow')
  })

  it('blocks Hermes from writing code directly', () => {
    const gate = new AegisPolicyGate()
    const decision = gate.evaluate('action.write_code', 'hermes')
    expect(decision.verdict).toBe('block')
    expect(decision.reason).toContain('not allowed')
  })

  it('blocks Hermes from patching code directly', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.patch_code', 'hermes').verdict).toBe('block')
  })

  it('blocks Hermes from executing shell commands', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.shell', 'hermes').verdict).toBe('block')
  })

  it('blocks Hermes from deploying', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.deploy', 'hermes').verdict).toBe('block')
  })

  it('allows Droid to deploy', () => {
    const gate = new AegisPolicyGate()
    expect(gate.evaluate('action.deploy', 'droid').verdict).toBe('allow')
  })

  it('blocks unknown actions', () => {
    const gate = new AegisPolicyGate()
    const decision = gate.evaluate('action.nonexistent', 'hermes')
    expect(decision.verdict).toBe('block')
    expect(decision.reason).toContain('Unknown action')
  })

  it('enters fail-secure mode and blocks everything', () => {
    const gate = new AegisPolicyGate()
    gate.setFailSecure(true)
    // Even read should be blocked in fail-secure
    expect(gate.evaluate('action.read_file', 'hermes').verdict).toBe('block')
    expect(gate.evaluate('action.write_file', 'droid').verdict).toBe('block')
    expect(gate.isFailSecure()).toBe(true)
  })

  it('audits all decisions', () => {
    const gate = new AegisPolicyGate()
    gate.evaluate('action.write_code', 'hermes')   // blocked
    gate.evaluate('action.write_documentation', 'hermes')  // allowed
    gate.evaluate('action.read_file', 'hermes')    // allowed
    gate.evaluate('action.deploy', 'droid')         // allowed

    const log = gate.getAuditLog()
    expect(log.length).toBe(4)
    expect(log[0].verdict).toBe('block')
    expect(log[1].verdict).toBe('allow')
    expect(log[2].verdict).toBe('allow')
    expect(log[3].verdict).toBe('allow')
  })

  it('exposes audit stats', () => {
    const gate = new AegisPolicyGate()
    gate.evaluate('action.write_file', 'hermes')
    gate.evaluate('action.write_file', 'hermes')
    gate.evaluate('action.read_file', 'hermes')
    gate.evaluate('action.deploy', 'droid')

    const stats = gate.getStats()
    expect(stats.total).toBe(4)
    expect(stats.blocked).toBe(2)
    expect(stats.allowed).toBe(2)
  })

  it('enforces delegation path: Hermes delegates, Droid executes', () => {
    const gate = new AegisPolicyGate()

    // Hermes cannot write code
    expect(gate.evaluate('action.write_code', 'hermes').verdict).toBe('block')

    // Hermes can write documentation
    expect(gate.evaluate('action.write_documentation', 'hermes').verdict).toBe('allow')

    // Hermes can delegate
    expect(gate.evaluate('action.delegate_task', 'hermes').verdict).toBe('allow')

    // Droid can write code
    expect(gate.evaluate('action.write_code', 'droid').verdict).toBe('allow')
  })

  it('provides singleton instance', () => {
    resetPolicyGate()
    const a = getPolicyGate()
    const b = getPolicyGate()
    expect(a).toBe(b)  // Same instance
  })
})
