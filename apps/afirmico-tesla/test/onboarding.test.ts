/**
 * Tests for member detail collection (FRS-010 F01-R05).
 *
 * These target the two ways this step silently corrupts data downstream: a
 * postcode losing its leading zero, and one human being stored as two members
 * because their number was typed three different ways.
 */

import { describe, expect, it } from 'vitest'
import { normaliseMobileAu, normalisePostcodeAu } from '../src/onboarding'

describe('Australian postcode normalisation (F01-R05, F01-R06)', () => {
  it('keeps a leading zero', () => {
    // The whole reason this returns a string. Coerced to a number, 0800 becomes
    // 800 — not a postcode, but a phantom bucket that aggregates Northern
    // Territory members with nobody and reports it as if it were a real segment.
    expect(normalisePostcodeAu('0800')).toBe('0800')
    expect(normalisePostcodeAu('0200')).toBe('0200')
    expect(normalisePostcodeAu('0234')).toBe('0234')
  })

  it('accepts an ordinary postcode unchanged', () => {
    expect(normalisePostcodeAu('2335')).toBe('2335')
    expect(normalisePostcodeAu('3000')).toBe('3000')
    expect(normalisePostcodeAu('9999')).toBe('9999')
  })

  it('trims surrounding whitespace', () => {
    expect(normalisePostcodeAu('  2335 ')).toBe('2335')
  })

  it('rejects an unallocated postcode below 0200', () => {
    // 0000-0199 are not allocated, so 0100 is a typo, not a location.
    expect(normalisePostcodeAu('0100')).toBeNull()
    expect(normalisePostcodeAu('0000')).toBeNull()
  })

  it('rejects anything that is not four digits', () => {
    expect(normalisePostcodeAu('')).toBeNull()
    expect(normalisePostcodeAu('233')).toBeNull()
    expect(normalisePostcodeAu('23355')).toBeNull()
    expect(normalisePostcodeAu('23a5')).toBeNull()
    expect(normalisePostcodeAu('NSW')).toBeNull()
    expect(normalisePostcodeAu('-2335')).toBeNull()
  })
})

describe('Australian mobile normalisation (F01-R05)', () => {
  it('collapses the spellings of one number to a single canonical form', () => {
    // If these did not collapse, one member's enquiries would split across three
    // spellings and the same person could be matched to two records.
    const forms = [
      '0412345678',
      '0412 345 678',
      '0412-345-678',
      '(04) 1234 5678',
      '+61412345678',
      '+61 412 345 678',
      '61412345678',
      '  0412 345 678  ',
    ]
    for (const form of forms) {
      expect(normaliseMobileAu(form)).toBe('+61412345678')
    }
  })

  it('returns E.164, so a local number cannot be confused with an international one', () => {
    expect(normaliseMobileAu('0400111222')).toBe('+61400111222')
  })

  it('rejects a non-mobile prefix', () => {
    // 05xx is not allocated to mobiles. Storing it would save a number that can
    // never receive an SMS, which is worse than rejecting it.
    expect(normaliseMobileAu('0512345678')).toBeNull()
    expect(normaliseMobileAu('0212345678')).toBeNull()
    expect(normaliseMobileAu('0312345678')).toBeNull()
  })

  it('rejects wrong lengths', () => {
    expect(normaliseMobileAu('041234567')).toBeNull()
    expect(normaliseMobileAu('04123456789')).toBeNull()
  })

  it('rejects blank and non-numeric input', () => {
    expect(normaliseMobileAu('')).toBeNull()
    expect(normaliseMobileAu('   ')).toBeNull()
    expect(normaliseMobileAu('not a phone')).toBeNull()
  })

  it('rejects a foreign number rather than mangling it into an AU one', () => {
    // +1 412 345 6780 must not be silently rehomed as an Australian mobile.
    expect(normaliseMobileAu('+14123456780')).toBeNull()
    expect(normaliseMobileAu('+441234567890')).toBeNull()
  })

  it('does not treat a local number beginning 61 as international', () => {
    // 6141234567 is 10 digits and starts with 61, but it is not a mobile and must
    // not be sliced into a valid-looking one.
    expect(normaliseMobileAu('6141234567')).toBeNull()
  })
})
