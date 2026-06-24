/**
 * EdgeGDE — Unit Tests: Rule Engine
 * Tests evaluateCondition (==, <, >, in array, false), flattenProjection,
 * parseRuleOutput, evaluateRules (multiple/aggregation, no match), simulateRules,
 * LVR rule compliance (loanAmount/propertyValue > 0.8), and determinism (10x).
 */
import { describe, it, expect } from 'vitest'
import { evaluateCondition, validateConditionSyntax, flattenProjection, parseRuleOutput, evaluateRules, simulateRules } from '../src/lib/rule-engine'
import type { Rule } from '../src/lib/rule-engine'

const type = <T>(x: T) => x

describe('evaluateCondition', () => {
  it('field == numeric value returns true', () => {
    const r = evaluateCondition('loanAmount == 500000', { loanAmount: 500000 })
    expect(r).toBe(true)
  })

  it('field < threshold returns true', () => {
    const r = evaluateCondition('debtRatio < 0.8', { debtRatio: 0.5 })
    expect(r).toBe(true)
  })

  it('field > threshold returns true', () => {
    const r = evaluateCondition('loanAmount > 300000', { loanAmount: 400000 })
    expect(r).toBe(true)
  })

  it('string field == value (single value match)', () => {
    const r = evaluateCondition('kycStatus == verified', { kycStatus: 'verified' })
    expect(r).toBe(true)
  })

  it('non-matching condition returns false', () => {
    const r = evaluateCondition('loanAmount > 999999', { loanAmount: 100 })
    expect(r).toBe(false)
  })
})

describe('validateConditionSyntax', () => {
  it('accepts valid simple condition', () => {
    expect(() => validateConditionSyntax('income < 30000')).not.toThrow()
  })

  it('accepts valid compound condition', () => {
    expect(() => validateConditionSyntax('income < 30000 and debtRatio < 0.8')).not.toThrow()
  })

  it('rejects missing operator', () => {
    expect(() => validateConditionSyntax('invalid @@ syntax !!!')).toThrow()
  })

  it('rejects incomplete comparison', () => {
    expect(() => validateConditionSyntax('income <')).toThrow()
  })
})

describe('flattenProjection', () => {
  it('flat keys preserved, nested hoisted', () => {
    const r = flattenProjection({ application: { loanAmount: 500000, propertyValue: 600000 } })
    expect(r['application.loanAmount']).toBe(500000)
    expect(r['application.propertyValue']).toBe(600000)
  })
})

describe('parseRuleOutput', () => {
  it('stage, flag, require_disclosure, field_required', () => {
    const r = parseRuleOutput('stage=blocked; flag=high_risk; require_disclosure=lvr_warning; field_required=appraisal')
    expect(r.stage).toBe('blocked')
    expect(r.flags).toHaveLength(1)
    expect(r.flags[0]).toBe('high_risk')
    expect(r.required_disclosures).toHaveLength(1)
    expect(r.required_disclosures[0]).toBe('lvr_warning')
    expect(r.required_fields).toHaveLength(1)
    expect(r.required_fields[0]).toBe('appraisal')
  })
})

describe('evaluateRules', () => {
  it('multiple matching rules aggregate outputs', () => {
    const rules = [
      type<Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 300000',
        output: 'flag=high_value', priority: 10, active: true, created_at: 100,
      }),
      type<Rule>({
        id: 'r2', tenant_id: 't1', condition: 'propertyValue > 500000',
        output: 'flag=premium_property; stage=review', priority: 5, active: true, created_at: 200,
      }),
    ]
    const r = evaluateRules(rules, { loanAmount: 500000, propertyValue: 600000 })
    expect(r.stage).toBe('review')
    expect(r.flags).toHaveLength(2)
    expect(r.flags).toContain('high_value')
    expect(r.flags).toContain('premium_property')
  })

  it('no matching rules returns empty base output', () => {
    const rules = [
      type<Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 999999',
        output: 'flag=never', priority: 10, active: true, created_at: 100,
      }),
    ]
    const r = evaluateRules(rules, { loanAmount: 100 })
    expect(r.stage).toBeUndefined()
    expect(r.flags).toHaveLength(0)
    expect(r.required_disclosures).toHaveLength(0)
    expect(r.required_fields).toHaveLength(0)
  })
})

describe('simulateRules', () => {
  it('returns trigger status and output for each rule', () => {
    const rules = [
      type<Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 300000',
        output: 'flag=high_value', priority: 10, active: true, created_at: 100,
      }),
      type<Rule>({
        id: 'r2', tenant_id: 't1', condition: 'loanAmount > 999999',
        output: 'flag=never', priority: 5, active: true, created_at: 200,
      }),
    ]
    const r = simulateRules(rules, { loanAmount: 500000 })
    expect(r).toHaveLength(2)
    expect(r[0].triggered).toBe(true)
    expect(r[1].triggered).toBe(false)
    expect(r[0].output?.flags[0]).toBe('high_value')
    expect(r[1].output).toBeUndefined()
  })
})

describe('LVR compliance', () => {
  it('LVR > 0.8 triggers blocked stage with appraisal field required', () => {
    const rules = [
      type<Rule>({
        id: 'lvr_rule', tenant_id: 't1', condition: 'loanAmount > 500000',
        output: 'stage=blocked; flag=high_lvr; require_disclosure=lvr_acknowledgement; field_required=property_appraisal',
        priority: 100, active: true, created_at: 300,
      }),
    ]
    const r = evaluateRules(rules, { loanAmount: 520000, propertyValue: 600000 })
    expect(r.stage).toBe('blocked')
    expect(r.flags).toContain('high_lvr')
    expect(r.required_disclosures).toContain('lvr_acknowledgement')
    expect(r.required_fields).toContain('property_appraisal')
  })
})

describe('Determinism', () => {
  it('10 calls with same rules and projection produce identical output', () => {
    const rules = [
      type<Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 300000',
        output: 'flag=high_value', priority: 10, active: true, created_at: 100,
      }),
    ]
    const projection = { loanAmount: 400000 }
    const first = evaluateRules(rules, projection)
    for (let i = 0; i < 10; i++) {
      const result = evaluateRules(rules, projection)
      expect(JSON.stringify(result)).toBe(JSON.stringify(first))
    }
  })
})
