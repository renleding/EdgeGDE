/**
 * EdgeGDE — Unit Tests: Error Narrowing
 *
 * Covers `errorMessage`, which narrows an unknown thrown value to a readable
 * string so route handlers never need an untyped catch binding.
 */
import { describe, it, expect } from 'vitest'
import { errorMessage } from '../src/lib/errors'

describe('errorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns a thrown string verbatim', () => {
    expect(errorMessage('plain string throw')).toBe('plain string throw')
  })

  it('returns the message of an Error subclass', () => {
    class CustomError extends Error {}
    expect(errorMessage(new CustomError('custom'))).toBe('custom')
  })

  it('reads a message property from a non-Error object', () => {
    expect(errorMessage({ message: 'object message' })).toBe('object message')
  })

  it('falls back when the message property is not a string', () => {
    expect(errorMessage({ message: 42 })).toBe('Unknown error')
  })

  it('falls back for null and undefined', () => {
    expect(errorMessage(null)).toBe('Unknown error')
    expect(errorMessage(undefined)).toBe('Unknown error')
  })

  it('falls back for a thrown number', () => {
    expect(errorMessage(418)).toBe('Unknown error')
  })

  it('always returns a non-empty string', () => {
    for (const value of [null, undefined, 0, false, '', {}, []]) {
      const result = errorMessage(value)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    }
  })
})
