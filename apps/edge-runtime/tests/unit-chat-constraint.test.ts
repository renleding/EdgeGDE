/**
 * EdgeGDE — Unit Tests: Chat Constraint Engine
 * Tests findNextField (first, complete), validateField (empty required, valid value,
 * invalid select, min/max, XSS input), applyFieldUpdate (store, completedFields, error for invalid).
 */
import { describe, it, expect } from 'vitest'
import { findNextField, validateField, applyFieldUpdate } from '../src/lib/chat-constraint'

const fields = [
  { fieldName: 'fullName', label: 'Full Name', fieldType: 'string' as const, validation: { required: true } },
  { fieldName: 'age', label: 'Age', fieldType: 'number' as const, validation: { required: true, min: 18, max: 120 } },
  { fieldName: 'occupation', label: 'Occupation', fieldType: 'select' as const, options: ['Employed', 'Self-Employed', 'Unemployed'], validation: { required: true } },
  { fieldName: 'notes', label: 'Notes', fieldType: 'string' as const, validation: { required: false } },
]

describe('findNextField', () => {
  it('returns first required field when nothing collected', () => {
    const { field, state } = findNextField(fields, {})
    expect(field).toBeDefined()
    expect(field!.fieldName).toBe('fullName')
    expect(state.phase).toBe('collecting')
    expect(state.completedFields).toHaveLength(0)
    expect(state.errors).toHaveLength(0)
  })

  it('returns null and complete phase when all required fields collected', () => {
    const { field, state } = findNextField(fields, {
      fullName: 'Alice', age: 30, occupation: 'Employed',
    })
    expect(field).toBeNull()
    expect(state.phase).toBe('complete')
    expect(state.completedFields).toContain('fullName')
    expect(state.completedFields).toContain('age')
    expect(state.completedFields).toContain('occupation')
  })
})

describe('validateField', () => {
  it('returns error for empty value on required field', () => {
    const err = validateField(fields[0], '')
    expect(err).not.toBeNull()
    expect(err!).toContain('Full Name')
  })

  it('returns null for valid string value', () => {
    const err = validateField(fields[0], 'Alice Johnson')
    expect(err).toBeNull()
  })

  it('returns error for value not in options', () => {
    const err = validateField(fields[2], 'Astronaut')
    expect(err).not.toBeNull()
    expect(err!).toContain('Occupation')
    expect(err!).toContain('Employed')
  })

  it('returns error for number below min', () => {
    const err = validateField(fields[1], 15)
    expect(err).not.toBeNull()
    expect(err!).toContain('at least 18')
  })

  it('returns null for number within range', () => {
    const err = validateField(fields[1], 25)
    expect(err).toBeNull()
  })

  it('accepts XSS-looking string as non-empty valid value', () => {
    const field = { fieldName: 'comment', label: 'Comment', fieldType: 'string' as const, validation: { required: false } }
    const err = validateField(field, '<script>alert("xss")</script>')
    expect(err).toBeNull()
  })

  it('accepts valid Australian phone number by field name', () => {
    const field = { fieldName: 'phoneNumber', label: 'Phone Number', fieldType: 'string' as const, validation: { required: true } }
    const err = validateField(field, '0412345678')
    expect(err).toBeNull()
  })

  it('rejects short Australian phone number by field name', () => {
    const field = { fieldName: 'phoneNumber', label: 'Phone Number', fieldType: 'string' as const, validation: { required: true } }
    const err = validateField(field, '04111')
    expect(err).not.toBeNull()
    expect(err!).toContain('10 digits')
  })

  it('rejects Australian phone number not starting with 04', () => {
    const field = { fieldName: 'phoneNumber', label: 'Phone Number', fieldType: 'string' as const, validation: { required: true } }
    const err = validateField(field, '0312345678')
    expect(err).not.toBeNull()
    expect(err!).toContain('04')
  })
})

describe('applyFieldUpdate', () => {
  it('stores value and returns completedFields with error null', () => {
    const { collected, error, state } = applyFieldUpdate(fields, {}, 'fullName', 'Bob Smith')
    expect(error).toBeNull()
    expect(collected['fullName']).toBe('Bob Smith')
    expect(state.completedFields).toContain('fullName')
    expect(state.currentField).toBe('age')
  })
})
