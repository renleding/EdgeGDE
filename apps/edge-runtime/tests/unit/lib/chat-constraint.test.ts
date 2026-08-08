import { describe, it, expect } from 'vitest'
import {
  fuzzyMatchOption,
  findNextField,
  validateField,
  applyFieldUpdate,
  normalizeChatFields,
} from '../../../src/lib/chat-constraint'
import type { ChatFieldDef } from '../../../src/lib/chat-constraint'

describe('fuzzyMatchOption', () => {
  const options = ['Employed', 'Self-Employed', 'Retired', 'Owner-occupied']

  it('returns null for empty option list', () => {
    expect(fuzzyMatchOption('x', [])).toBeNull()
  })

  it('matches exact option case-insensitively, returning original casing', () => {
    expect(fuzzyMatchOption('  SELF-EMPLOYED  ', options)).toBe('Self-Employed')
    expect(fuzzyMatchOption('employed', options)).toBe('Employed')
  })

  it('matches prefix (user types "owner" → "Owner-occupied")', () => {
    expect(fuzzyMatchOption('owner', options)).toBe('Owner-occupied')
  })

  it('matches contains (substring in the middle)', () => {
    expect(fuzzyMatchOption('occupied', options)).toBe('Owner-occupied')
  })

  it('matches by Levenshtein distance ≤ 2', () => {
    expect(fuzzyMatchOption('Employd', options)).toBe('Employed') // distance 1
    expect(fuzzyMatchOption('Retierd', options)).toBe('Retired') // distance 1
  })

  it('returns null when nothing matches within 2 edits', () => {
    expect(fuzzyMatchOption('Unicorn', options)).toBeNull()
    expect(fuzzyMatchOption('zzzzzzzzzz', options)).toBeNull()
  })

  it('treats blank input as an empty prefix — matches the first option', () => {
    // Actual behavior: ''.startsWith('') is true, so the first option wins.
    expect(fuzzyMatchOption('   ', options)).toBe('Employed')
  })
})

describe('levenshtein-driven branch coverage', () => {
  it('falls through exact/prefix/contains to the distance loop and picks a later option', () => {
    const opts = ['Employed', 'Self-Employed', 'Retired', 'Owner-occupied']
    // 'retierd' fails exact/prefix/contains for every option; only the
    // distance loop finds 'Retired' (after skipping 'Employed' with d > 2).
    expect(fuzzyMatchOption('retierd', opts)).toBe('Retired')
  })
})

describe('findNextField', () => {
  const fields: ChatFieldDef[] = [
    { fieldName: 'name', label: 'Name', fieldType: 'string' },
    { fieldName: 'age', label: 'Age', fieldType: 'number', validation: { min: 0 } },
    { fieldName: 'notes', label: 'Notes', fieldType: 'string', validation: { required: false } },
  ]

  it('returns phase complete with empty state for no fields', () => {
    const r = findNextField([], {})
    expect(r.field).toBeNull()
    expect(r.state).toEqual({ currentField: '', completedFields: [], errors: [], phase: 'complete' })
  })

  it('returns the first missing required field in declaration order', () => {
    const r = findNextField(fields, {})
    expect(r.field?.fieldName).toBe('name')
    expect(r.state.phase).toBe('collecting')
    expect(r.state.currentField).toBe('name')
    expect(r.state.completedFields).toEqual([])
    expect(r.state.errors).toEqual([])
  })

  it('skips fields with required === false', () => {
    const r = findNextField(fields, { name: 'Sam', age: 30 })
    expect(r.field).toBeNull()
    expect(r.state.phase).toBe('complete')
    expect(r.state.completedFields).toEqual(['name', 'age'])
  })

  it('treats undefined/null/empty-string collected values as missing', () => {
    const r = findNextField(fields, { name: undefined, age: null, notes: '' })
    expect(r.field?.fieldName).toBe('name')
  })

  it('treats 0 as collected (not empty)', () => {
    const numeric: ChatFieldDef[] = [{ fieldName: 'income', label: 'Income', fieldType: 'number' }]
    const r = findNextField(numeric, { income: 0 })
    expect(r.field).toBeNull()
    expect(r.state.phase).toBe('complete')
    expect(r.state.completedFields).toEqual(['income'])
  })

  it('treats false as collected but validates it against select options', () => {
    // Actual behavior: false is "not empty" so it is validated; for a select
    // field String(false) = "false" is not in the options → validation error.
    const select: ChatFieldDef[] = [{ fieldName: 'flag', label: 'Flag', fieldType: 'select', options: ['Yes', 'No'] }]
    const r = findNextField(select, { flag: false })
    expect(r.field?.fieldName).toBe('flag')
    expect(r.state.phase).toBe('collecting')
    expect(r.state.errors).toEqual(['flag: Flag must be one of: Yes, No'])
  })

  it('records validation errors for invalid collected values and still asks for the field', () => {
    const r = findNextField(fields, { name: 'Sam', age: 'abc' })
    expect(r.field?.fieldName).toBe('age')
    expect(r.state.errors).toEqual(['age: Age must be a number'])
    expect(r.state.completedFields).toEqual(['name'])
  })
})

describe('validateField — required/empty', () => {
  const field: ChatFieldDef = { fieldName: 'name', label: 'Full Name', fieldType: 'string' }

  it('returns required error for undefined', () => {
    expect(validateField(field, undefined)).toBe('Full Name is required')
  })

  it('returns required error for null', () => {
    expect(validateField(field, null)).toBe('Full Name is required')
  })

  it('returns required error for empty string', () => {
    expect(validateField(field, '')).toBe('Full Name is required')
  })

  it('returns null for empty value when required === false', () => {
    expect(validateField({ ...field, validation: { required: false } }, '')).toBeNull()
    expect(validateField({ ...field, validation: { required: false } }, undefined)).toBeNull()
  })
})

describe('validateField — number fields', () => {
  const field: ChatFieldDef = { fieldName: 'income', label: 'Income', fieldType: 'number' }

  it('cleans currency formatting from string input', () => {
    expect(validateField(field, '$85,000')).toBeNull()
    expect(validateField(field, '1,200/5')).toBeNull()
  })

  it('rejects non-numeric input', () => {
    expect(validateField(field, 'abc')).toBe('Income must be a number')
  })

  it('enforces min', () => {
    expect(validateField({ ...field, validation: { min: 10 } }, 5)).toBe('Income must be at least 10')
  })

  it('enforces max', () => {
    expect(validateField({ ...field, validation: { max: 10 } }, 15)).toBe('Income must be at most 10')
  })

  it('passes a number within bounds', () => {
    expect(validateField({ ...field, validation: { min: 0, max: 100 } }, 42)).toBeNull()
  })

  it('accepts numeric string values', () => {
    expect(validateField(field, '42')).toBeNull()
  })
})

describe('validateField — string fields', () => {
  const field: ChatFieldDef = { fieldName: 'city', label: 'City', fieldType: 'string' }

  it('enforces minLength', () => {
    expect(validateField({ ...field, validation: { minLength: 3 } }, 'ab')).toBe('City must be at least 3 characters')
  })

  it('enforces maxLength', () => {
    expect(validateField({ ...field, validation: { maxLength: 3 } }, 'abcd')).toBe('City must be at most 3 characters')
  })

  it('passes a string within length bounds', () => {
    expect(validateField({ ...field, validation: { minLength: 1, maxLength: 5 } }, 'syd')).toBeNull()
  })
})

describe('validateField — select fields', () => {
  const field: ChatFieldDef = { fieldName: 'status', label: 'Status', fieldType: 'select', options: ['Employed', 'Retired'] }

  it('rejects a value not in the list, listing options', () => {
    expect(validateField(field, 'Unicorn')).toBe('Status must be one of: Employed, Retired')
  })

  it('accepts an option case-insensitively', () => {
    expect(validateField(field, '  employed ')).toBeNull()
  })

  it('skips validation when options are absent or empty', () => {
    expect(validateField({ ...field, options: undefined }, 'anything')).toBeNull()
    expect(validateField({ ...field, options: [] }, 'anything')).toBeNull()
  })
})

describe('validateField — email fieldName heuristic', () => {
  const email: ChatFieldDef = { fieldName: 'email', label: 'Email', fieldType: 'string' }

  it('flags missing @ symbol', () => {
    expect(validateField(email, 'nope')).toBe('Email address is missing the @ symbol. Please include @domain.com')
  })

  it('flags missing dot entirely', () => {
    expect(validateField(email, 'a@b')).toBe('Email domain appears incomplete. Please use a format like name@domain.com')
  })

  it('flags missing local part before @', () => {
    expect(validateField(email, '@b.com')).toBe('Email address is missing the local part before @')
  })

  it('flags multiple @ separators', () => {
    expect(validateField(email, 'a@b@c.com')).toBe('Email address is missing the local part before @')
  })

  it('flags a domain without a dot even when the local part has one', () => {
    expect(validateField(email, 'a.b@c')).toBe('Email domain "c" appears incomplete. Did you mean c.com?')
  })

  it('accepts a well-formed email', () => {
    expect(validateField(email, 'sam@example.com')).toBeNull()
  })

  it('also triggers for fieldName emailaddress (case-insensitive)', () => {
    const e2: ChatFieldDef = { fieldName: 'EmailAddress', label: 'Email', fieldType: 'string' }
    expect(validateField(e2, 'nope')).toBe('Email address is missing the @ symbol. Please include @domain.com')
  })
})

describe('validateField — phone fieldName heuristic', () => {
  const phone: ChatFieldDef = { fieldName: 'phone', label: 'Phone', fieldType: 'string' }

  it('rejects non-10-digit numbers', () => {
    expect(validateField(phone, '041234567')).toBe('Phone number must be exactly 10 digits')
    expect(validateField(phone, '04123456789')).toBe('Phone number must be exactly 10 digits')
  })

  it('rejects numbers not starting with 04', () => {
    expect(validateField(phone, '0512345678')).toBe('Phone number must start with 04')
  })

  it('accepts formatted 04 numbers, stripping non-digits', () => {
    expect(validateField(phone, '0412 345 678')).toBeNull()
    expect(validateField(phone, '0412-345-678')).toBeNull()
  })

  it('triggers for any fieldName containing "phone"', () => {
    const mobile: ChatFieldDef = { fieldName: 'mobilePhone', label: 'Mobile', fieldType: 'string' }
    expect(validateField(mobile, '123')).toBe('Phone number must be exactly 10 digits')
    expect(validateField(mobile, '0412345678')).toBeNull()
  })
})

describe('validateField — non-validated values', () => {
  it('returns null for a plain string field with no validation', () => {
    expect(validateField({ fieldName: 'x', label: 'X', fieldType: 'string' }, 'hello')).toBeNull()
  })
})

describe('applyFieldUpdate', () => {
  const fields: ChatFieldDef[] = [
    { fieldName: 'status', label: 'Status', fieldType: 'select', options: ['Employed', 'Self-Employed'] },
    { fieldName: 'income', label: 'Income', fieldType: 'number', validation: { min: 0 } },
    { fieldName: 'city', label: 'City', fieldType: 'string' },
  ]

  it('rejects unknown fields', () => {
    const collected = { city: 'syd' }
    const r = applyFieldUpdate(fields, collected, 'nope', 'x')
    expect(r.error).toBe('Unknown field: nope')
    expect(r.collected).toBe(collected)
    expect(r.state).toEqual({
      currentField: '',
      completedFields: ['city'],
      errors: ['Unknown field: nope'],
      phase: 'collecting',
    })
  })

  it('fuzzy-corrects select values before storing', () => {
    const r = applyFieldUpdate(fields, {}, 'status', 'self')
    expect(r.error).toBeNull()
    expect(r.collected.status).toBe('Self-Employed')
  })

  it('rejects an invalid select value and keeps collected unchanged', () => {
    const collected = { city: 'syd' }
    const r = applyFieldUpdate(fields, collected, 'status', 'Unicorn')
    expect(r.error).toBe('Status must be one of: Employed, Self-Employed')
    expect(r.collected).toBe(collected)
    expect(r.state.currentField).toBe('status')
    expect(r.state.errors).toEqual(['Status must be one of: Employed, Self-Employed'])
  })

  it('stores formatted number strings as numbers', () => {
    const r = applyFieldUpdate(fields, {}, 'income', '$1,500')
    expect(r.error).toBeNull()
    expect(r.collected.income).toBe(1500)
  })

  it('stores numeric values as numbers', () => {
    const r = applyFieldUpdate(fields, {}, 'income', 42)
    expect(r.collected.income).toBe(42)
  })

  it('rejects values failing number validation', () => {
    const r = applyFieldUpdate(fields, {}, 'income', '-5')
    expect(r.error).toBe('Income must be at least 0')
    expect(r.collected).toEqual({})
  })

  it('stores non-number fields as-is', () => {
    const r = applyFieldUpdate(fields, {}, 'city', 'Sydney')
    expect(r.collected.city).toBe('Sydney')
    expect(r.error).toBeNull()
  })

  it('returns the next state via findNextField after a successful update', () => {
    const r = applyFieldUpdate(fields, {}, 'city', 'Sydney')
    expect(r.state.phase).toBe('collecting')
    expect(r.state.currentField).toBe('status')
    expect(r.state.completedFields).toEqual(['city'])
  })

  it('skips option validation entirely when select has no options', () => {
    // Actual behavior: the options check requires options.length > 0, so an
    // empty option list means the raw value passes validation untouched.
    const noOpts: ChatFieldDef[] = [{ fieldName: 's', label: 'S', fieldType: 'select', options: [] }]
    const r = applyFieldUpdate(noOpts, {}, 's', 'anything')
    expect(r.error).toBeNull()
    expect(r.collected).toEqual({ s: 'anything' })
  })
})

describe('normalizeChatFields', () => {
  it('returns an empty array for no fields', () => {
    expect(normalizeChatFields([])).toEqual([])
  })

  it('applies defaults for missing fieldName/label/fieldType', () => {
    expect(normalizeChatFields([{}])).toEqual([
      { fieldName: '', label: '', fieldType: 'string', options: undefined, prompt: undefined, validation: undefined, placeholder: undefined },
    ])
  })

  it('falls back label to fieldName', () => {
    const r = normalizeChatFields([{ fieldName: 'name' }])
    expect(r[0].label).toBe('name')
  })

  it('preserves supplied options/prompt/validation/placeholder', () => {
    const r = normalizeChatFields([{
      fieldName: 'status',
      fieldType: 'select',
      options: ['A'],
      prompt: 'Pick one',
      validation: { required: true },
      placeholder: 'choose',
    }])
    expect(r[0]).toEqual({
      fieldName: 'status',
      label: 'status',
      fieldType: 'select',
      options: ['A'],
      prompt: 'Pick one',
      validation: { required: true },
      placeholder: 'choose',
    })
  })
})
