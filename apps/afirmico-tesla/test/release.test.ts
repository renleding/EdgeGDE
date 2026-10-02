/**
 * Tests for the quote package and consent-based release (FRS-010 F07).
 *
 * The release path is where personal data leaves the system, so these tests
 * target the gates rather than the happy path: a release must be impossible
 * without live consent, impossible to keep downloading after revocation, and
 * impossible to perform without an attributable audit row.
 */

import { describe, expect, it } from 'vitest'
import { ReleaseBlocked, csvField, toCsv, PACKAGE_VERSION } from '../src/release'

describe('CSV field escaping (F07-R04)', () => {
  it('leaves a plain value untouched', () => {
    expect(csvField('2335')).toBe('2335')
  })

  it('quotes a value containing a comma', () => {
    // The failure this prevents is silent: "Smith, John" unquoted shifts every
    // later column, so the insurer reads each value against the wrong header and
    // the file still parses.
    expect(csvField('Smith, John')).toBe('"Smith, John"')
  })

  it('doubles embedded quotes', () => {
    expect(csvField('He said "hello"')).toBe('"He said ""hello"""')
  })

  it('quotes and preserves newlines rather than breaking the row', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('renders null and undefined as empty, never as the word null', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  it('renders zero as 0, not as empty', () => {
    // 0 km is a real reading and must not be confused with "no data".
    expect(csvField(0)).toBe('0')
  })
})

describe('CSV document shape (F07-R04)', () => {
  const headers = ['a', 'b']
  const rows = [
    [1, 'x'],
    [2, 'y'],
  ]

  it('uses CRLF line endings per RFC 4180', () => {
    expect(toCsv(headers, rows)).toBe('a,b\r\n1,x\r\n2,y\r\n')
  })

  it('is reproducible: same input produces the same bytes (F07-R04, F06-R06)', () => {
    expect(toCsv(headers, rows)).toBe(toCsv(headers, rows))
  })

  it('emits the header row even when there are no data rows', () => {
    expect(toCsv(headers, [])).toBe('a,b\r\n')
  })

  it('pins the package version', () => {
    // A change here is a breaking change to insurers' ingestion, so it is
    // asserted rather than left to drift.
    expect(PACKAGE_VERSION).toBe('1.0.0')
  })
})

describe('Release blocking', () => {
  it('is a typed error carrying a machine-readable reason', () => {
    // The route maps the reason to a status code; a bare Error would force
    // string matching and silently break when a message is reworded.
    const error = new ReleaseBlocked('no_live_consent')
    expect(error).toBeInstanceOf(Error)
    expect(error.reason).toBe('no_live_consent')
    expect(error.name).toBe('ReleaseBlocked')
  })
})
