/**
 * Guard: a D1 test double must be able to REJECT invalid SQL.
 *
 * THE BLIND SPOT THIS PREVENTS
 * ----------------------------
 * A test double whose `prepare()` accepts any string cannot tell a valid column from an
 * invalid one. That is how a production endpoint shipped returning HTTP 500 while the
 * suite was green:
 *
 *     no such column: observed_at at offset 11: SQLITE_ERROR [code: 7500]
 *
 * It was the third production failure to come through the same gap. Fixing the one broken
 * query does not stop the next one, so this asserts the property that makes the whole class
 * visible: the double must reject what the real database rejects.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. The shared harness itself refuses a nonexistent column — so the harness cannot be
 *      quietly weakened into a permissive stub later.
 *   2. Every test file that provides a `D1_TESLA` uses that shared harness, rather than
 *      hand-rolling a stub. A hand-rolled stub is exactly how the pattern recurs.
 *   3. The migrated schema is actually present in the harness, so tests are not passing
 *      against an empty database that happens to accept everything.
 *
 * (2) is the structural check and is deliberately blunt: it does not try to detect whether
 * a bespoke stub is "permissive enough", because that judgement is what failed before. A
 * D1 double either comes from the shared, validating harness, or it is flagged.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createSqliteD1,
  assertRejectsInvalidSql,
  MIGRATION_COUNT,
  type SqliteD1,
} from './helpers/sqlite-d1'

const TEST_DIR = import.meta.dirname

/** Test files that are not suites and should be skipped by the scan. */
const NOT_A_SUITE = ['helpers']

describe('the D1 test harness validates SQL rather than accepting anything', () => {
  it('refuses a column that does not exist', () => {
    const d1 = createSqliteD1()
    // The exact failing shape from production: a real table, a column it does not have.
    expect(
      () => d1._db.prepare('SELECT observed_at FROM tesla_telemetry_batch'),
      'tesla_telemetry_batch has no observed_at — the harness must raise',
    ).toThrow(/no such column/i)
  })

  it('accepts the correct query, so the harness is not simply always failing', () => {
    const d1 = createSqliteD1()
    // Without this, a harness that threw on everything would satisfy the test above.
    expect(() =>
      d1._db.prepare('SELECT observed_at FROM tesla_telemetry_fact'),
    ).not.toThrow()
  })

  it('the self-check helper agrees, and would fail a permissive double', () => {
    const real = createSqliteD1()
    expect(() => assertRejectsInvalidSql(real), 'the real harness passes its own check').not.toThrow()

    // A permissive double — the shape that shipped the bug — must fail the check.
    const permissive = {
      prepare: () => ({ bind: () => ({}), first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) }),
      batch: async () => [],
      _db: { prepare: () => ({}) },
      _seed: () => {},
      _rows: () => [],
    } as unknown as SqliteD1
    expect(
      () => assertRejectsInvalidSql(permissive),
      'a double that cannot reject SQL must fail the assertion',
    ).toThrow(/cannot reject|not validating|accepted a query/i)
  })

  it('the harness carries the real migrated schema, not an empty database', () => {
    // An empty schema accepts nothing, so tests would fail loudly rather than silently —
    // but assert it anyway so a path mistake surfaces here rather than as a confusing
    // "no such table" in an unrelated suite.
    expect(MIGRATION_COUNT).toBeGreaterThan(10)
    const d1 = createSqliteD1()
    const tables = d1._rows(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tesla_%'",
    )
    expect(tables.length, 'migrated tables must be present').toBeGreaterThan(MIGRATION_COUNT)
  })

  it('enforces constraints, so invalid DATA is caught as well as invalid SQL', () => {
    const d1 = createSqliteD1()
    // A permissive stub accepts both of these. The migrations reject both.
    expect(
      () => d1._seed("INSERT INTO tesla_member (member_id, toca_status, email, created_at, updated_at) VALUES ('x','not_a_real_status','a@b.c','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')"),
      'the CHECK constraint on toca_status must hold',
    ).toThrow()
    expect(
      () => d1._seed("INSERT INTO tesla_vehicle (vin, member_id, display_name, first_seen_at) VALUES ('V','ghost-member','X','2026-01-01T00:00:00Z')"),
      'the foreign key on member_id must hold',
    ).toThrow()
  })
})

describe('no test file hand-rolls a D1 double', () => {
  const suites = readdirSync(TEST_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.test.ts'))
    .map((e) => e.name)

  it('found test files to scan, so this guard is not vacuous', () => {
    expect(suites.length, 'the scan must find suites').toBeGreaterThan(10)
  })

  it('every suite that provides a D1_TESLA uses the validating harness', () => {
    const offenders: string[] = []
    for (const name of suites) {
      if (NOT_A_SUITE.some((s) => name.startsWith(s))) continue
      const src = readFileSync(join(TEST_DIR, name), 'utf8')

      // Only files that actually stand up a D1 binding are in scope.
      if (!/D1_TESLA\s*:/.test(src)) continue

      // The escape hatch must be an import of the shared harness. Looked for as a real
      // import rather than a mention, so a comment naming the helper does not satisfy it.
      const usesHarness = /import\s*\{[^}]*createSqliteD1[^}]*\}\s*from\s*['"][^'"]*sqlite-d1['"]/.test(src)
      if (!usesHarness) offenders.push(name)
    }

    expect(
      offenders,
      'these suites build a D1 double by hand, so a bad column in their SQL would be ' +
        'invisible — import createSqliteD1 from ./helpers/sqlite-d1 instead:\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('no suite uses catch-all mock shapes for D1', () => {
    // The specific constructs that caused the gap. Named explicitly because they are
    // what someone would reach for when adding a suite in a hurry.
    const offenders: string[] = []
    for (const name of suites) {
      const src = readFileSync(join(TEST_DIR, name), 'utf8')
      // Strip block comments and line comments so the documentation in admin-console.test.ts
      // (which quotes these shapes to explain them) is not flagged.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      if (/prepare:\s*vi\.fn\(\)/.test(code) || /prepare:\s*\([^)]*\)\s*=>\s*\w+\s*[,}]/.test(code)) {
        offenders.push(name)
      }
    }
    expect(offenders, `catch-all D1 mocks must not return:\n${offenders.join('\n')}`).toEqual([])
  })
})
