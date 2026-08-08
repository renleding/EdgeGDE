import { describe, it, expect } from 'vitest'
import { computeFieldState, applyRules } from '../../../src/lib/field-engine'
import type { FieldDef } from '../../../src/lib/field-engine'

function def(fieldName: string): FieldDef {
  return { fieldName, label: fieldName, fieldType: 'text', validation: { required: true } }
}

describe('computeFieldState', () => {
  const fields = [def('name'), def('age'), def('city')]

  it('reports complete when everything in priority order is collected', () => {
    const r = computeFieldState(fields, ['name', 'age', 'city'], { name: 'Sam', age: 30, city: 'Sydney' })
    expect(r.missingFields).toEqual([])
    expect(r.nextField).toBeNull()
    expect(r.phase).toBe('complete')
  })

  it('lists missing fields in priority order (not declaration order)', () => {
    const r = computeFieldState(fields, ['city', 'name'], { age: 30 })
    expect(r.missingFields.map(f => f.fieldName)).toEqual(['city', 'name'])
    expect(r.nextField?.fieldName).toBe('city')
    expect(r.phase).toBe('collecting')
  })

  it('ignores priority names with no matching field definition', () => {
    const r = computeFieldState(fields, ['name', 'ghost', 'age'], {})
    expect(r.missingFields.map(f => f.fieldName)).toEqual(['name', 'age'])
  })

  it('ignores collected keys not in priority order', () => {
    const r = computeFieldState(fields, ['name'], { name: 'Sam', city: 'Sydney', extra: 1 })
    expect(r.phase).toBe('complete')
    expect(r.missingFields).toEqual([])
  })

  it('returns complete with null nextField for an empty priority list', () => {
    const r = computeFieldState(fields, [], {})
    expect(r.missingFields).toEqual([])
    expect(r.nextField).toBeNull()
    expect(r.phase).toBe('complete')
  })

  it('treats empty-string and null values as collected (key presence only)', () => {
    // Actual behavior: membership is decided by Object.keys() presence,
    // not by value truthiness — '' and null still count as collected.
    const r = computeFieldState(fields, ['name'], { name: '' })
    expect(r.phase).toBe('complete')
    expect(r.missingFields).toEqual([])
    const r2 = computeFieldState(fields, ['name'], { name: null })
    expect(r2.phase).toBe('complete')
  })
})

describe('applyRules', () => {
  it('returns an empty object for no rules', () => {
    expect(applyRules([], {})).toEqual({})
  })

  it('skips rules whose condition does not match the regex', () => {
    const r = applyRules(
      [{ if: 'no operators here', set: { field: 'stage', value: 'x' } }],
      {},
    )
    expect(r).toEqual({})
  })

  it('skips rules referencing uncollected (undefined/null) fields', () => {
    const r = applyRules(
      [
        { if: 'income > 100', set: { field: 'stage', value: 'blocked' } },
        { if: 'income < 100', set: { field: 'stage', value: 'blocked' } },
      ],
      { income: null },
    )
    expect(r).toEqual({})
  })

  it('applies < comparisons', () => {
    const r = applyRules([{ if: 'income < 100', set: { field: 'stage', value: 'blocked' } }], { income: 50 })
    expect(r).toEqual({ stage: 'blocked' })
  })

  it('does not apply < when the condition fails', () => {
    const r = applyRules([{ if: 'income < 100', set: { field: 'stage', value: 'blocked' } }], { income: 150 })
    expect(r).toEqual({})
  })

  it('applies > comparisons', () => {
    const r = applyRules([{ if: 'income > 100', set: { field: 'stage', value: 'blocked' } }], { income: 150 })
    expect(r).toEqual({ stage: 'blocked' })
  })

  it('never matches <= — greedy regex parses it as op "<" with value "= 100"', () => {
    // Actual behavior: the alternation (<|>|<=|>=|==|!=) tries "<" first, so
    // "income <= 100" is parsed as op "<", rawValue "= 100" → Number("= 100") is
    // NaN → comparison is false. The <= and >= switch cases are unreachable.
    const r = applyRules([{ if: 'income <= 100', set: { field: 'stage', value: 'ok' } }], { income: 100 })
    expect(r).toEqual({})
  })

  it('never matches >= — greedy regex parses it as op ">" with value "= 100"', () => {
    const r = applyRules([{ if: 'income >= 100', set: { field: 'stage', value: 'ok' } }], { income: 100 })
    expect(r).toEqual({})
  })

  it('applies == with string coercion', () => {
    const r = applyRules([{ if: 'stage == blocked', set: { field: 'flag', value: true } }], { stage: 'blocked' })
    expect(r).toEqual({ flag: true })
  })

  it('applies == with numeric coercion', () => {
    const r = applyRules([{ if: 'income == 100', set: { field: 'flag', value: true } }], { income: 100 })
    expect(r).toEqual({ flag: true })
  })

  it('applies == when string and number stringify identically', () => {
    // Actual behavior: both sides are stringified, so '100' (string) == 100 (number).
    const r = applyRules([{ if: 'income == 100', set: { field: 'flag', value: true } }], { income: '100' })
    expect(r).toEqual({ flag: true })
  })

  it('does not apply == when stringified values genuinely differ', () => {
    const r = applyRules([{ if: 'income == 100', set: { field: 'flag', value: true } }], { income: 'abc' })
    expect(r).toEqual({})
  })

  it('applies != comparisons', () => {
    const r = applyRules([{ if: 'stage != done', set: { field: 'flag', value: 'pending' } }], { stage: 'active' })
    expect(r).toEqual({ flag: 'pending' })
  })

  it('does not apply != when values are equal', () => {
    const r = applyRules([{ if: 'stage != done', set: { field: 'flag', value: 'pending' } }], { stage: 'done' })
    expect(r).toEqual({})
  })

  it('coerces string actuals to numbers for relational operators', () => {
    const r = applyRules([{ if: 'income > 100', set: { field: 'stage', value: 'blocked' } }], { income: '150' })
    expect(r).toEqual({ stage: 'blocked' })
  })

  it('compares NaN-coerced values as false for relational operators', () => {
    const r = applyRules([{ if: 'income < 100', set: { field: 'stage', value: 'blocked' } }], { income: 'abc' })
    expect(r).toEqual({})
  })

  it('handles field names with digits', () => {
    const r = applyRules([{ if: 'income2 > 50', set: { field: 'stage', value: 'ok' } }], { income2: 60 })
    expect(r).toEqual({ stage: 'ok' })
  })

  it('applies multiple rules, only keeping matched updates', () => {
    const r = applyRules(
      [
        { if: 'income > 100', set: { field: 'stage', value: 'blocked' } },
        { if: 'age < 18', set: { field: 'minor', value: true } },
        { if: 'bogus!!', set: { field: 'x', value: 1 } },
      ],
      { income: 150, age: 30 },
    )
    expect(r).toEqual({ stage: 'blocked' })
  })

  it('stores the rule-set value verbatim (string, number, boolean)', () => {
    const r = applyRules(
      [
        { if: 'a == 1', set: { field: 's', value: 'text' } },
        { if: 'a == 1', set: { field: 'n', value: 42 } },
        { if: 'a == 1', set: { field: 'b', value: false } },
      ],
      { a: 1 },
    )
    expect(r).toEqual({ s: 'text', n: 42, b: false })
  })
})
