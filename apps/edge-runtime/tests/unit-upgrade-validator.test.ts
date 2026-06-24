/**
 * EdgeGDE — Unit Tests: Pack Upgrade Validator & Differ
 * Tests validatePackCompatibility (field refs, condition syntax)
 * and generatePackDiff (added/removed/modified rules, compliance,
 * impact scoring, empty diffs, and determinism).
 */
import { describe, it, expect } from 'vitest'
import { validatePackCompatibility, generatePackDiff } from '../src/factory/upgrade/upgrade.validator'

describe('validatePackCompatibility', () => {
  it('passes for valid rules referencing existing fields', () => {
    const rules = [
      { condition: 'annualIncome < 50000', output: 'flag=low_income' },
      { condition: 'age > 65', output: 'flag=senior' },
    ]
    const fields = ['annualIncome', 'age']
    const result = validatePackCompatibility(rules, fields)
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('warns for unknown field references in conditions', () => {
    const rules = [
      { condition: 'mysteryField == yes', output: 'flag=unknown' },
    ]
    const fields = ['annualIncome']
    const result = validatePackCompatibility(rules, fields)
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('mysteryField')
  })

  it('reports errors for invalid condition syntax', () => {
    const rules = [
      { condition: '', output: 'flag=bad' },
    ]
    const fields = ['annualIncome']
    const result = validatePackCompatibility(rules, fields)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('generatePackDiff — structural detections', () => {
  it('detects added rules (present in new, absent in old)', () => {
    const oldRules = [{ condition: 'age > 18', output: 'flag=adult' }]
    const newRules = [
      { condition: 'age > 18', output: 'flag=adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
    ]
    const diff = generatePackDiff(oldRules, newRules)
    expect(diff.rulesAdded).toHaveLength(1)
    expect(diff.rulesAdded[0]).toBe('income < 30000')
    expect(diff.rulesRemoved).toHaveLength(0)
  })

  it('detects removed rules (absent in new, present in old)', () => {
    const oldRules = [
      { condition: 'age > 18', output: 'flag=adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
    ]
    const newRules = [{ condition: 'age > 18', output: 'flag=adult' }]
    const diff = generatePackDiff(oldRules, newRules)
    expect(diff.rulesRemoved).toHaveLength(1)
    expect(diff.rulesRemoved[0]).toBe('income < 30000')
    expect(diff.rulesAdded).toHaveLength(0)
  })

  it('detects modified rules (same condition, different output)', () => {
    const oldRules = [{ condition: 'age > 18', output: 'flag=adult' }]
    const newRules = [{ condition: 'age > 18', output: 'flag=verified_adult' }]
    const diff = generatePackDiff(oldRules, newRules)
    expect(diff.rulesModified).toHaveLength(1)
    expect(diff.rulesModified[0].condition).toBe('age > 18')
    expect(diff.rulesModified[0].oldOutput).toBe('flag=adult')
    expect(diff.rulesModified[0].newOutput).toBe('flag=verified_adult')
  })

  it('detects compliance additions', () => {
    const oldCompliance = [{ value: 'lvr_warning', type: 'compliance' }]
    const newCompliance = [
      { value: 'lvr_warning', type: 'compliance' },
      { value: 'fee_disclosure', type: 'compliance' },
    ]
    const diff = generatePackDiff([], [], oldCompliance, newCompliance)
    expect(diff.complianceAdded).toHaveLength(1)
    expect(diff.complianceAdded[0]).toBe('fee_disclosure')
  })

  it('detects compliance removals', () => {
    const oldCompliance = [
      { value: 'lvr_warning', type: 'compliance' },
      { value: 'fee_disclosure', type: 'compliance' },
    ]
    const newCompliance = [{ value: 'lvr_warning', type: 'compliance' }]
    const diff = generatePackDiff([], [], oldCompliance, newCompliance)
    expect(diff.complianceRemoved).toHaveLength(1)
    expect(diff.complianceRemoved[0]).toBe('fee_disclosure')
  })
})

describe('generatePackDiff — impact scoring', () => {
  it('impactScore LOW for small changes', () => {
    const oldRules = [{ condition: 'a == 1', output: 'x' }]
    const newRules = [{ condition: 'a == 1', output: 'y' }]
    const diff = generatePackDiff(oldRules, newRules)
    expect(diff.impactScore).toBe('LOW')
  })

  it('impactScore MEDIUM for moderate changes', () => {
    const oldRules = [{ condition: 'a == 1', output: 'x' }]
    const newRules = [
      { condition: 'a == 1', output: 'y' },
      { condition: 'b == 2', output: 'z' },
      { condition: 'c == 3', output: 'w' },
    ]
    const diff = generatePackDiff(oldRules, newRules)
    expect(diff.impactScore).toBe('MEDIUM')
  })

  it('impactScore HIGH for significant changes', () => {
    const oldRules = [{ condition: 'a == 1', output: 'x' }]
    const newRules = [
      { condition: 'a == 1', output: 'y' },
      { condition: 'b == 2', output: 'z' },
      { condition: 'c == 3', output: 'w' },
      { condition: 'd == 4', output: 'v' },
      { condition: 'e == 5', output: 'u' },
      { condition: 'f == 6', output: 't' },
    ]
    const diff = generatePackDiff(oldRules, newRules)
    expect(diff.impactScore).toBe('HIGH')
  })
})

describe('generatePackDiff — edge cases', () => {
  it('empty arrays when no changes', () => {
    const rules = [{ condition: 'a == 1', output: 'x' }]
    const diff = generatePackDiff(rules, rules)
    expect(diff.rulesAdded).toHaveLength(0)
    expect(diff.rulesRemoved).toHaveLength(0)
    expect(diff.rulesModified).toHaveLength(0)
    expect(diff.complianceAdded).toHaveLength(0)
    expect(diff.complianceRemoved).toHaveLength(0)
    expect(diff.impactStatements).toHaveLength(0)
    expect(diff.impactScore).toBe('LOW')
  })
})

describe('Determinism', () => {
  it('10 identical generatePackDiff calls produce identical output', () => {
    const oldRules = [
      { condition: 'age > 18', output: 'flag=adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
    ]
    const newRules = [
      { condition: 'age > 18', output: 'flag=verified_adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
      { condition: 'creditScore > 700', output: 'flag=good_credit' },
    ]
    const oldCompliance = [{ value: 'base_disclosure', type: 'compliance' }]
    const newCompliance = [
      { value: 'base_disclosure', type: 'compliance' },
      { value: 'premium_disclosure', type: 'compliance' },
    ]

    const first = generatePackDiff(oldRules, newRules, oldCompliance, newCompliance)
    for (let i = 0; i < 10; i++) {
      const result = generatePackDiff(oldRules, newRules, oldCompliance, newCompliance)
      expect(JSON.stringify(result)).toBe(JSON.stringify(first))
    }
  })
})
