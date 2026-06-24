/**
 * Tests for computeDrift — pure function, deterministic, no mocks needed.
 */
import { describe, it, expect } from 'vitest'
import { computeDrift, computeDriftScore } from '../../src/actions/compute-drift'

describe('computeDrift', () => {
  it('returns empty array when states match exactly', () => {
    const state = { status: 'approved', score: 85, provider: 'BankA' }
    const result = computeDrift(state, { ...state })
    expect(result).toEqual([])
  })

  it('detects missing keys', () => {
    const expected = { status: 'approved', score: 85 }
    const actual = { status: 'approved' }
    const result = computeDrift(expected, actual)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: 'score', type: 'missing', severity: 'error' })
  })

  it('detects extra keys', () => {
    const expected = { status: 'approved' }
    const actual = { status: 'approved', refundId: 'R1' }
    const result = computeDrift(expected, actual)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: 'refundId', type: 'extra', severity: 'info' })
  })

  it('detects value mismatches', () => {
    const expected = { status: 'approved' }
    const actual = { status: 'pending' }
    const result = computeDrift(expected, actual)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: 'status', type: 'mismatch', severity: 'warning' })
  })

  it('detects stale version fields', () => {
    const expected = { config: { version: 5, name: 'v5-config' } }
    const actual = { config: { version: 3, name: 'v3-config' } }
    const result = computeDrift(expected, actual)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ type: 'stale', severity: 'error' })
    expect(result[0].path).toBe('config')
  })

  it('detects derived_error for _computed keys', () => {
    const expected = { score: 85, bucket_computed: 'hot' }
    const actual = { score: 85, bucket_computed: 'warm' }
    const result = computeDrift(expected, actual)
    const derived = result.find(r => r.type === 'derived_error')
    expect(derived).toBeDefined()
    expect(derived!.severity).toBe('error')
  })

  it('detects mismatches in nested objects', () => {
    const expected = { quote: { rate: 5.2, provider: 'BankA' } }
    const actual = { quote: { rate: 5.2, provider: 'BankB' } }
    const result = computeDrift(expected, actual)
    expect(result.length).toBeGreaterThan(0)
    const mismatch = result.find(r => r.path === 'quote.provider')
    expect(mismatch).toBeDefined()
    expect(mismatch!.type).toBe('mismatch')
  })

  it('handles empty objects', () => {
    expect(computeDrift({}, {})).toEqual([])
    expect(computeDrift({ a: 1 }, {})).toHaveLength(1)
    expect(computeDrift({}, { a: 1 })).toHaveLength(1)
  })

  it('returns multiple drifts for complex mismatches', () => {
    const expected = {
      status: 'approved',
      score: 85,
      bucket_computed: 'hot',
      config: { version: 5 },
    }
    const actual = {
      status: 'pending',
      score: 60,
      bucket_computed: 'warm',
      config: { version: 3 },
      extraField: 'unexpected',
    }
    const result = computeDrift(expected, actual)
    // Should find: status mismatch, score mismatch, bucket derived_error,
    // config stale, extraField extra
    expect(result.length).toBeGreaterThanOrEqual(4)
  })

  it('computes zero score for zero drift', () => {
    const state = { status: 'approved', score: 85 }
    expect(computeDriftScore(computeDrift(state, state))).toBe(0)
  })

  it('computes non-zero score when drift exists', () => {
    const expected = { status: 'approved', score: 85 }
    const actual = { status: 'pending', score: 85 }
    const drifts = computeDrift(expected, actual)
    expect(computeDriftScore(drifts)).toBeGreaterThan(0)
    // 'mismatch' with severity 'warning' = 0.3
    expect(computeDriftScore(drifts)).toBeCloseTo(0.3)
  })

  it('computes higher score for stale + missing combination', () => {
    const expected = { config: { version: 5 }, status: 'approved' }
    const actual = { config: { version: 2 } } // missing status, stale config
    const drifts = computeDrift(expected, actual)
    const score = computeDriftScore(drifts)
    // stale = 1.0 + 1.0(severity), missing = 0.5 + 1.0(severity) + 0.5(bonus)
    expect(score).toBeGreaterThan(1.0)
  })
})
