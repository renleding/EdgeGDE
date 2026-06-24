/**
 * EdgeGDE — Unit Tests: Zod Schemas (Blueprint, PackRef, ChatConfig)
 * Tests schema validation rules, defaults, and determinism.
 */
import { describe, it, expect } from 'vitest'
import { ChatConfigSchema, FALLBACK_CONFIG } from '../src/lib/chat-config'
import { BlueprintSchema, PackRefSchema } from '../src/factory/blueprint/blueprint.schema'

describe('ChatConfigSchema', () => {
  it('rejects empty objective', () => {
    expect(() =>
      ChatConfigSchema.parse({
        objective: '',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: ['a'],
      }),
    ).toThrow()
  })

  it('rejects empty fields array', () => {
    expect(() =>
      ChatConfigSchema.parse({
        objective: 'test',
        fields: [],
        priorityOrder: ['a'],
      }),
    ).toThrow()
  })

  it('rejects empty priorityOrder', () => {
    expect(() =>
      ChatConfigSchema.parse({
        objective: 'test',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: [],
      }),
    ).toThrow()
  })

  it('accepts valid config with defaults', () => {
    const result = ChatConfigSchema.parse({
      objective: 'Collect contact info',
      fields: [{ fieldName: 'email', label: 'Email Address' }],
      priorityOrder: ['email'],
    })
    expect(result.objective).toBe('Collect contact info')
    expect(result.fields).toHaveLength(1)
    expect(result.fields[0].fieldType).toBe('text')
    expect(result.fields[0].validation.required).toBe(true)
    expect(Array.isArray(result.rules)).toBe(true)
    expect(result.knowledgeBase).toBeDefined()
    expect(Array.isArray(result.knowledgeBase!.topics)).toBe(true)
  })

  it('FALLBACK_CONFIG includes deterministic mortgage intake fields', () => {
    expect(FALLBACK_CONFIG.priorityOrder).toHaveLength(10)
    expect(FALLBACK_CONFIG.priorityOrder[2]).toBe('phone')
    const phone = FALLBACK_CONFIG.fields.find(f => f.fieldName === 'phone')
    expect(phone).toBeDefined()
    expect(phone!.fieldType).toBe('phone')
  })

  it('preserves all field properties through parse', () => {
    const input = {
      objective: 'Test invariant',
      fields: [
        {
          fieldName: 'test1', label: 'Test 1', fieldType: 'text',
          prompt: 'What is test 1?', options: ['A', 'B'],
          placeholder: 'Enter here', validation: { required: true },
        },
        { fieldName: 'test2', label: 'Test 2', fieldType: 'number', validation: { required: true } },
      ],
      priorityOrder: ['test1', 'test2'],
      knowledgeBase: { topics: [] },
    }
    const parsed = ChatConfigSchema.parse(input)
    const f = parsed.fields[0]
    expect(f.fieldName).toBe('test1')
    expect(f.label).toBe('Test 1')
    expect(f.prompt).toBe('What is test 1?')
    expect(f.options).toHaveLength(2)
    expect(f.placeholder).toBe('Enter here')
    expect(f.validation!.required).toBe(true)
  })
})

describe('BlueprintSchema', () => {
  it('accepts valid blueprint with 2 fields + priorityOrder', () => {
    const result = BlueprintSchema.parse({
      id: 'bp-loan',
      version: '1.0.0',
      fields: [
        { fieldName: 'income', label: 'Annual Income', fieldType: 'number' },
        { fieldName: 'name', label: 'Full Name', fieldType: 'text' },
      ],
      priorityOrder: ['income', 'name'],
    })
    expect(result.id).toBe('bp-loan')
    expect(result.version).toBe('1.0.0')
    expect(result.fields).toHaveLength(2)
    expect(result.priorityOrder).toHaveLength(2)
  })

  it('rejects missing id', () => {
    expect(() =>
      BlueprintSchema.parse({
        version: '1.0.0',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: ['a'],
      }),
    ).toThrow()
  })

  it('rejects missing version', () => {
    expect(() =>
      BlueprintSchema.parse({
        id: 'bp-test',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: ['a'],
      }),
    ).toThrow()
  })
})

describe('PackRefSchema', () => {
  it('validates {name, version} object', () => {
    const result = PackRefSchema.parse({ name: 'lvr-pack', version: '2.1.0' })
    expect(result.name).toBe('lvr-pack')
    expect(result.version).toBe('2.1.0')
  })

  it('rejects flat string', () => {
    expect(() => PackRefSchema.parse('lvr-pack')).toThrow()
  })
})

describe('Determinism', () => {
  it('5 identical parses produce identical output', () => {
    const input = {
      id: 'bp-deter',
      version: '1.0.0',
      fields: [
        { fieldName: 'x', label: 'X', fieldType: 'text' },
        { fieldName: 'y', label: 'Y', fieldType: 'number' },
      ],
      priorityOrder: ['x', 'y'],
    }
    const first = BlueprintSchema.parse(input)
    for (let i = 0; i < 5; i++) {
      const result = BlueprintSchema.parse(input)
      expect(JSON.stringify(result)).toBe(JSON.stringify(first))
    }
  })
})
