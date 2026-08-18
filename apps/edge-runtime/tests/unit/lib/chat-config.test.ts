import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatConfigSchema, FALLBACK_CONFIG, loadChatConfig } from '../../../src/lib/chat-config'

const MINIMAL_VALID = {
  objective: 'Collect info',
  fields: [{ fieldName: 'name', label: 'Name' }],
  priorityOrder: ['name'],
}

function makeKv(raw: unknown) {
  return {
    get: async () => raw,
  }
}

describe('ChatConfigSchema', () => {
  it('applies defaults to a minimal valid config', () => {
    const parsed = ChatConfigSchema.parse(MINIMAL_VALID)
    expect(parsed.objective).toBe('Collect info')
    expect(parsed.fields[0].fieldType).toBe('text')
    expect(parsed.fields[0].validation).toEqual({ required: true })
    expect(parsed.rules).toEqual([])
    expect(parsed.knowledgeBase).toEqual({ topics: [] })
    expect(parsed.llmFallback).toBe(true)
    expect(parsed.ui).toEqual({ title: 'EdgeGDE Chat', greeting: "Welcome! Let's get started.", colorAccent: '#58a6ff' })
  })

  it('defaults nested validation fields while preserving provided ones', () => {
    const parsed = ChatConfigSchema.parse({
      ...MINIMAL_VALID,
      fields: [{ fieldName: 'income', label: 'Income', fieldType: 'number', validation: { min: 0 } }],
      priorityOrder: ['income'],
    })
    expect(parsed.fields[0].validation).toEqual({ required: true, min: 0 })
  })

  it('applies ui defaults when ui is provided partially', () => {
    const parsed = ChatConfigSchema.parse({ ...MINIMAL_VALID, ui: { title: 'Custom' } })
    expect(parsed.ui).toEqual({ title: 'Custom', greeting: "Welcome! Let's get started.", colorAccent: '#58a6ff' })
  })

  it('rejects an empty objective', () => {
    expect(() => ChatConfigSchema.parse({ ...MINIMAL_VALID, objective: '' })).toThrow()
  })

  it('rejects an empty fields array', () => {
    expect(() => ChatConfigSchema.parse({ ...MINIMAL_VALID, fields: [] })).toThrow()
  })

  it('rejects an empty priorityOrder', () => {
    expect(() => ChatConfigSchema.parse({ ...MINIMAL_VALID, priorityOrder: [] })).toThrow()
  })

  it('rejects an empty fieldName', () => {
    expect(() => ChatConfigSchema.parse({
      ...MINIMAL_VALID,
      fields: [{ fieldName: '', label: 'X' }],
    })).toThrow()
  })

  it('rejects an invalid fieldType', () => {
    expect(() => ChatConfigSchema.parse({
      ...MINIMAL_VALID,
      fields: [{ fieldName: 'n', label: 'N', fieldType: 'color' }],
    })).toThrow()
  })

  it('accepts FALLBACK_CONFIG as valid', () => {
    const parsed = ChatConfigSchema.parse(FALLBACK_CONFIG)
    expect(parsed.fields).toHaveLength(10)
    expect(parsed.priorityOrder).toHaveLength(10)
    expect(parsed.ui?.title).toBe('EdgeGDE Chat')
    expect(parsed.llmFallback).toBe(true)
  })
})

describe('loadChatConfig', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns FALLBACK_CONFIG when kv has no config', async () => {
    const cfg = await loadChatConfig(makeKv(null), 'acme')
    expect(cfg).toBe(FALLBACK_CONFIG)
    expect(console.warn).toHaveBeenCalled()
  })

  it('returns FALLBACK_CONFIG when kv.get throws', async () => {
    const kv = { get: async () => { throw new Error('kv down') } }
    const cfg = await loadChatConfig(kv, 'acme')
    expect(cfg).toBe(FALLBACK_CONFIG)
  })

  it('returns the parsed config when valid', async () => {
    const raw = {
      objective: 'Collect info',
      fields: [{ fieldName: 'name', label: 'Name', fieldType: 'text' }],
      priorityOrder: ['name'],
      llmFallback: false,
    }
    const cfg = await loadChatConfig(makeKv(raw), 'acme')
    expect(cfg.objective).toBe('Collect info')
    expect(cfg.fields[0].validation).toEqual({ required: true })
    expect(cfg.rules).toEqual([])
    expect(cfg.knowledgeBase).toEqual({ topics: [] })
    expect(cfg.llmFallback).toBe(false)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('keeps extra keys out of the returned config (zod strips unknown top-level keys)', async () => {
    const raw = { ...MINIMAL_VALID, extraKey: 'stripped' }
    const cfg = await loadChatConfig(makeKv(raw), 'acme')
    expect((cfg as any).extraKey).toBeUndefined()
  })

  it('returns FALLBACK_CONFIG when upgrade_status is pending', async () => {
    const raw = { ...MINIMAL_VALID, upgrade_status: 'pending' }
    const cfg = await loadChatConfig(makeKv(raw), 'acme')
    expect(cfg).toBe(FALLBACK_CONFIG)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Upgrade pending'), 'acme', expect.anything())
  })

  it('returns FALLBACK_CONFIG when priorityOrder references an unknown field', async () => {
    const raw = { ...MINIMAL_VALID, priorityOrder: ['name', 'ghost'] }
    const cfg = await loadChatConfig(makeKv(raw), 'acme')
    expect(cfg).toBe(FALLBACK_CONFIG)
  })

  it('returns FALLBACK_CONFIG when the raw config fails schema validation', async () => {
    const raw = { ...MINIMAL_VALID, fields: [] }
    const cfg = await loadChatConfig(makeKv(raw), 'acme')
    expect(cfg).toBe(FALLBACK_CONFIG)
  })
})
