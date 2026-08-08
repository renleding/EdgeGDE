import { describe, it, expect } from 'vitest'
import { canonicalNumber, stableStringify } from '../../../src/lib/hash'

describe('canonicalNumber', () => {
  it('returns null for non-finite values', () => {
    expect(canonicalNumber(NaN)).toBe('null')
    expect(canonicalNumber(Infinity)).toBe('null')
    expect(canonicalNumber(-Infinity)).toBe('null')
  })

  it('passes integers and plain decimals through unchanged', () => {
    expect(canonicalNumber(42)).toBe('42')
    expect(canonicalNumber(0)).toBe('0')
    expect(canonicalNumber(-7)).toBe('-7')
    expect(canonicalNumber(3.14)).toBe('3.14')
  })

  it('expands positive scientific notation to full decimal', () => {
    expect(canonicalNumber(1e3)).toBe('1000')
    expect(canonicalNumber(1.5e3)).toBe('1500')
    expect(canonicalNumber(1.234e2)).toBe('123.4')
    expect(canonicalNumber(123e2)).toBe('12300')
  })

  it('expands positive scientific notation with fractional remainder', () => {
    // 1.2345e2 = 123.45
    expect(canonicalNumber(1.2345e2)).toBe('123.45')
  })

  it('expands negative scientific notation to leading-zero decimal', () => {
    expect(canonicalNumber(1e-3)).toBe('0.001')
    expect(canonicalNumber(5e-2)).toBe('0.05')
    expect(canonicalNumber(123e-4)).toBe('0.0123')
    // 1e-1 = 0.1
    expect(canonicalNumber(1e-1)).toBe('0.1')
  })

  it('expands negative scientific notation with fraction', () => {
    // 1.5e-3 = 0.0015
    expect(canonicalNumber(1.5e-3)).toBe('0.0015')
  })
})

describe('stableStringify', () => {
  it('serializes null and undefined as null', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(undefined)).toBe('null')
  })

  it('serializes booleans lowercase', () => {
    expect(stableStringify(true)).toBe('true')
    expect(stableStringify(false)).toBe('false')
  })

  it('serializes numbers canonically', () => {
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify(1e3)).toBe('1000')
  })

  it('serializes strings as JSON strings', () => {
    expect(stableStringify('hello')).toBe('"hello"')
    expect(stableStringify('a"b')).toBe('"a\\"b"')
  })

  it('preserves array positional integrity', () => {
    expect(stableStringify([1, 2, 3])).toBe('[1,2,3]')
    expect(stableStringify([1, 'x', true, null])).toBe('[1,"x",true,null]')
    expect(stableStringify([])).toBe('[]')
  })

  it('sorts object keys alphabetically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('nests objects and arrays deterministically', () => {
    const input = { z: [3, 1], a: { y: 1, x: 2 } }
    expect(stableStringify(input)).toBe('{"a":{"x":2,"y":1},"z":[3,1]}')
  })

  it('handles scientific notation inside objects', () => {
    expect(stableStringify({ big: 1e3 })).toBe('{"big":1000}')
  })
})
