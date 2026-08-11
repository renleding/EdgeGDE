import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  roundMoney,
  formatAud,
  formatPercent,
  registerCalculator,
  listCalculators,
  getCalculator,
  executeCalculator,
  safePow,
  safeDivide,
} from '../../../src/lib/calculator-engine'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('roundMoney', () => {
  it('rounds to two decimal places', () => {
    expect(roundMoney(123.456)).toBe(123.46)
    expect(roundMoney(10.1)).toBe(10.1)
    expect(roundMoney(100)).toBe(100)
  })

  it('rounds negative values symmetrically', () => {
    expect(roundMoney(-5.678)).toBe(-5.68)
  })
})

describe('formatAud', () => {
  it('formats positive amounts with commas and two decimals', () => {
    expect(formatAud(1234567.891)).toBe('$1,234,567.89')
    expect(formatAud(0)).toBe('$0.00')
    expect(formatAud(99.5)).toBe('$99.50')
  })

  it('prefixes negative amounts with a minus sign', () => {
    expect(formatAud(-1234.5)).toBe('-$1,234.50')
  })
})

describe('formatPercent', () => {
  it('defaults to two decimals', () => {
    expect(formatPercent(12.5)).toBe('12.50%')
    expect(formatPercent(1.999)).toBe('2.00%')
  })

  it('honors a custom decimals argument', () => {
    expect(formatPercent(12.345, 1)).toBe('12.3%')
    expect(formatPercent(0, 0)).toBe('0%')
  })
})

describe('calculator registry', () => {
  const def = {
    id: 'unit-test-loan',
    name: 'Unit Test Loan',
    description: 'test',
    category: 'loan' as const,
    inputSchema: z.object({ income: z.number() }),
    execute: (input: any) => ({ total: input.income * 2 }),
  }

  it('registers and retrieves a calculator', () => {
    registerCalculator(def)
    expect(getCalculator(def.id)).toBe(def)
    expect(listCalculators()).toContain(def)
  })

  it('returns undefined for an unregistered id', () => {
    expect(getCalculator('does-not-exist')).toBeUndefined()
  })

  it('throws when registering a duplicate id', () => {
    expect(() => registerCalculator(def)).toThrow('Calculator "unit-test-loan" is already registered')
  })

  it('returns a fresh array from listCalculators', () => {
    expect(Array.isArray(listCalculators())).toBe(true)
  })
})

describe('executeCalculator — unknown calculator', () => {
  it('returns a failure result with the id as name', () => {
    const r = executeCalculator('missing-calc', {})
    expect(r.success).toBe(false)
    expect(r.calculatorId).toBe('missing-calc')
    expect(r.calculatorName).toBe('missing-calc')
    expect(r.error).toBe('Unknown calculator: "missing-calc"')
    expect(r.data).toBeUndefined()
    expect(r.executedAt).toMatch(ISO_RE)
  })
})

describe('executeCalculator — schema validation', () => {
  const def = {
    id: 'unit-test-schema',
    name: 'Schema Calc',
    description: 'test',
    category: 'general' as const,
    inputSchema: z.object({ income: z.number(), name: z.string() }),
    execute: (input: any) => ({ ok: true, income: input.income }),
  }

  it('joins validation issues into a single error string', () => {
    registerCalculator(def)
    const r = executeCalculator(def.id, {})
    expect(r.success).toBe(false)
    expect(r.calculatorName).toBe('Schema Calc')
    expect(r.error).toBe('income: Invalid input: expected number, received undefined; name: Invalid input: expected string, received undefined')
    expect(r.executedAt).toMatch(ISO_RE)
  })

  it('joins nested paths with dots', () => {
    const nested = {
      id: 'unit-test-nested',
      name: 'Nested',
      description: 'test',
      category: 'general' as const,
      inputSchema: z.object({ a: z.object({ b: z.string() }) }),
      execute: () => ({}),
    }
    registerCalculator(nested)
    const r = executeCalculator(nested.id, { a: {} })
    expect(r.success).toBe(false)
    expect(r.error).toBe('a.b: Invalid input: expected string, received undefined')
  })
})

describe('executeCalculator — execution', () => {
  const def = {
    id: 'unit-test-exec',
    name: 'Exec Calc',
    description: 'test',
    category: 'budget' as const,
    inputSchema: z.object({ x: z.number() }),
    execute: (input: any) => ({ doubled: input.x * 2 }),
  }

  it('returns data on success', () => {
    registerCalculator(def)
    const r = executeCalculator(def.id, { x: 21 })
    expect(r.success).toBe(true)
    expect(r.calculatorName).toBe('Exec Calc')
    expect(r.data).toEqual({ doubled: 42 })
    expect(r.error).toBeUndefined()
    expect(r.executedAt).toMatch(ISO_RE)
  })

  it('captures Error messages from a throwing execute', () => {
    const boom = {
      id: 'unit-test-throw',
      name: 'Thrower',
      description: 'test',
      category: 'general' as const,
      inputSchema: z.object({}),
      execute: () => { throw new Error('boom') },
    }
    registerCalculator(boom)
    const r = executeCalculator(boom.id, {})
    expect(r.success).toBe(false)
    expect(r.error).toBe('boom')
  })

  it('stringifies non-Error throws', () => {
    const weird = {
      id: 'unit-test-throw-str',
      name: 'Weird',
      description: 'test',
      category: 'general' as const,
      inputSchema: z.object({}),
      execute: () => { throw 'just a string' },
    }
    registerCalculator(weird)
    const r = executeCalculator(weird.id, {})
    expect(r.success).toBe(false)
    expect(r.error).toBe('just a string')
  })
})

describe('safe helpers', () => {
  it('safePow delegates to Math.pow', () => {
    expect(safePow(2, 10)).toBe(1024)
    expect(safePow(3, 0)).toBe(1)
    expect(safePow(4, 0.5)).toBe(2)
  })

  it('safeDivide divides normally', () => {
    expect(safeDivide(10, 2)).toBe(5)
    expect(safeDivide(1, 3)).toBeCloseTo(0.3333, 3)
  })

  it('safeDivide throws on zero denominator', () => {
    expect(() => safeDivide(1, 0)).toThrow('Division by zero')
    expect(() => safeDivide(0, 0)).toThrow('Division by zero')
  })
})
