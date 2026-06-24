/**
 * EdgeGDE — Unit Tests: Field Engine
 * Tests computeFieldState: first field, priority order, skip collected, complete,
 * empty/edge cases, and determinism (10x).
 */
import { describe, it, expect } from 'vitest'
import { computeFieldState } from '../src/lib/field-engine'

const fields = [
  { fieldName: 'fullName', label: 'Full Name', fieldType: 'text' as const, validation: { required: true } },
  { fieldName: 'email', label: 'Email', fieldType: 'email' as const, validation: { required: true } },
  { fieldName: 'phone', label: 'Phone', fieldType: 'phone' as const, validation: { required: true } },
  { fieldName: 'income', label: 'Annual Income', fieldType: 'number' as const, validation: { required: true } },
]
const priorityOrder = ['fullName', 'email', 'phone', 'income']

describe('computeFieldState', () => {
  it('returns first priority field when collected is empty', () => {
    const r = computeFieldState(fields, priorityOrder, {})
    expect(r.phase).toBe('collecting')
    expect(r.nextField).toBeDefined()
    expect(r.nextField!.fieldName).toBe('fullName')
    expect(r.missingFields).toHaveLength(4)
  })

  it('returns second field after first collected', () => {
    const r = computeFieldState(fields, priorityOrder, { fullName: 'Alice' })
    expect(r.nextField).toBeDefined()
    expect(r.nextField!.fieldName).toBe('email')
    expect(r.missingFields).toHaveLength(3)
  })

  it('skips collected fields, returns next missing in priority order', () => {
    const r = computeFieldState(fields, priorityOrder, { fullName: 'Alice', email: 'a@b.com', phone: '0400000000' })
    expect(r.nextField).toBeDefined()
    expect(r.nextField!.fieldName).toBe('income')
    expect(r.missingFields).toHaveLength(1)
  })

  it('returns complete phase when all fields collected', () => {
    const r = computeFieldState(fields, priorityOrder, {
      fullName: 'Alice', email: 'a@b.com', phone: '0400000000', income: 75000,
    })
    expect(r.phase).toBe('complete')
    expect(r.nextField).toBeNull()
    expect(r.missingFields).toHaveLength(0)
  })

  it('returns complete for empty fields array', () => {
    const r = computeFieldState([], [], {})
    expect(r.phase).toBe('complete')
    expect(r.nextField).toBeNull()
  })

  it('returns complete for empty priorityOrder', () => {
    const r = computeFieldState(fields, [], {})
    expect(r.phase).toBe('complete')
    expect(r.missingFields).toHaveLength(0)
  })

  it('ignores unknown fields not in priorityOrder', () => {
    const r = computeFieldState(fields, priorityOrder, { unknownField: 'whatever' })
    expect(r.nextField).toBeDefined()
    expect(r.nextField!.fieldName).toBe('fullName')
  })

  it('maintains priority order even with out-of-order collection', () => {
    const r = computeFieldState(fields, priorityOrder, { phone: '0400000000', fullName: 'Bob' })
    expect(r.nextField).toBeDefined()
    expect(r.nextField!.fieldName).toBe('email')
  })

  it('determinism: 10 calls with same input produce identical result', () => {
    const state = { fullName: 'Charlie', email: 'c@d.com' }
    const first = computeFieldState(fields, priorityOrder, state)
    for (let i = 0; i < 10; i++) {
      const result = computeFieldState(fields, priorityOrder, state)
      expect(JSON.stringify(result)).toBe(JSON.stringify(first))
    }
  })
})
