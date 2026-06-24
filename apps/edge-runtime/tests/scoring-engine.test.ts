/**
 * EdgeGDE — FNS40821 Deterministic Scoring Engine Tests
 * Pure function tests. Exact assertions only.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import { computeDeterministic } from '../src/lib/scoring-engine'

describe('scoring-engine — Base Score', () => {
  it('base score is 30 with no inputs', () => {
    expect(computeDeterministic({}).score).toBe(30)
  })

  it('missing inputs still returns base 30', () => {
    expect(computeDeterministic({ propertyValue: undefined, loanAmount: undefined }).score).toBe(30)
  })

  it('null and zero inputs are handled gracefully', () => {
    expect(computeDeterministic({ propertyValue: 0, loanAmount: 0 }).score).toBe(30)
  })
})

describe('scoring-engine — LVR Scoring', () => {
  it('LVR <80%: base 30 + 20 = 50', () => {
    const r = computeDeterministic({ propertyValue: 1000000, loanAmount: 700000 })
    expect(r.score).toBe(50)
    expect(r.details.some(d => d.includes('LVR') && d.includes('< 80%'))).toBeTruthy()
  })

  it('LVR exactly 79.9%: +20', () => {
    expect(computeDeterministic({ propertyValue: 1000000, loanAmount: 799000 }).score).toBe(50)
  })

  it('LVR exactly 80%: +10', () => {
    expect(computeDeterministic({ propertyValue: 1000000, loanAmount: 800000 }).score).toBe(40)
  })

  it('LVR 80-90%: base 30 + 10 = 40', () => {
    expect(computeDeterministic({ propertyValue: 1000000, loanAmount: 850000 }).score).toBe(40)
  })

  it('LVR 80-90% edge at 90%: +10', () => {
    expect(computeDeterministic({ propertyValue: 1000000, loanAmount: 900000 }).score).toBe(40)
  })

  it('LVR >90%: base 30 + 0 = 30', () => {
    expect(computeDeterministic({ propertyValue: 1000000, loanAmount: 950000 }).score).toBe(30)
  })
})

describe('scoring-engine — Employment Scoring', () => {
  it('PAYG: base 30 + 20 = 50', () => {
    expect(computeDeterministic({ employmentType: 'PAYG' }).score).toBe(50)
  })

  it('payg lowercase: base 30 + 20 = 50', () => {
    expect(computeDeterministic({ employmentType: 'payg' }).score).toBe(50)
  })

  it('full-time: base 30 + 20 = 50', () => {
    expect(computeDeterministic({ employmentType: 'full-time' }).score).toBe(50)
  })

  it('part-time: base 30 + 20 = 50', () => {
    expect(computeDeterministic({ employmentType: 'part-time' }).score).toBe(50)
  })

  it('Self-Employed: base 30 + 0 = 30', () => {
    expect(computeDeterministic({ employmentType: 'Self-Employed' }).score).toBe(30)
  })

  it('self employed (no hyphen): base 30 + 0 = 30', () => {
    expect(computeDeterministic({ employmentType: 'self employed' }).score).toBe(30)
  })
})

describe('scoring-engine — Combined Scenarios', () => {
  it('LVR <80% + PAYG = max 70', () => {
    expect(computeDeterministic({
      propertyValue: 1000000,
      loanAmount: 100000,
      employmentType: 'PAYG',
    }).score).toBe(70)
  })

  it('LVR <80% + Self-Employed = 50', () => {
    expect(computeDeterministic({
      propertyValue: 1000000,
      loanAmount: 700000,
      employmentType: 'Self-Employed',
    }).score).toBe(50)
  })

  it('score never exceeds 70', () => {
    const r = computeDeterministic({
      propertyValue: 1000000,
      loanAmount: 1,
      employmentType: 'PAYG',
    })
    expect(r.score <= 70).toBeTruthy()
    expect(r.score).toBe(70)
  })
})
