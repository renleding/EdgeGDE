/**
 * Tests for the general-authorisation copy rule (FRS-010 F01-R10, widened at v1.25).
 *
 * The owner's position: the authorisation is general. The collected fields are
 * NOT specified to the member, and nothing asserts a bound on the set.
 *
 * Why this test sweeps documents rather than one page. The narrow-scope claim
 * was noticed in the `/toca-connect` intro, fixed there, and immediately
 * recurred elsewhere — in §3.7 of the specification, in F04-R05 as a verbatim
 * quote of the ruling, in AC6's note, and as a negative enumeration in
 * F04-R01a. A requirement scoped to the paragraph could not have stopped that.
 *
 * This is not stylistic enforcement. Each removed sentence reads as a
 * specification of the bound, and the next person to work on the field set will
 * treat it as one. The set itself is unchanged (14 fields) and the per-field
 * justifications are untouched — what is banned is a claim about what the
 * collection is *limited to*.
 *
 * Scope of the scan — what is deliberately NOT checked:
 *   - the changelog table (`| 1.x |` rows) and resolved/withdrawn risk rows.
 *     These describe what was removed and must be able to quote it; a changelog
 *     that cannot name the phrasing it retired is useless.
 *   - test files. A regression test asserting that a phrase does NOT appear in
 *     the consent text has to name the phrase to do so.
 *   - "driver data": the name of the profile category disclosed to underwriters
 *     (F05-R03/R04). It is a true statement about what is *released*, which is a
 *     different claim from what is collected.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../..', import.meta.url))

/** Banned phrasings: each asserts a bound on what is collected. */
const BANNED: Array<[string, RegExp]> = [
  ['"no behavior just kms and fsd kms" (the ruling quoted as a set bound)', /no behaviou?r just kms/i],
  ['"only two numbers"', /only two numbers/i],
  ['"two numbers"', /\btwo numbers\b/i],
  ['"only three fields"', /only three fields/i],
  ['"only two fields"', /only two fields/i],
  ['"just kms"', /just kms/i],
  ['"kms and fsd" presented as the set', /kms and fsd/i],
  ['"no behaviour signal" framing', /no behaviou?r (or location )?signal/i],
  ['negative enumeration of excluded signal classes', /no speed, acceleration, pedal/i],
]

/** Historical records, which must be able to quote what was retired. */
function isHistoricalFile(path: string): boolean {
  return /\/test\//.test(path) || path.endsWith('general-authorisation-copy.test.ts')
}

function isHistoricalLine(line: string): boolean {
  if (/^\|\s*1\.\d+\s*\|/.test(line)) return true              // changelog row
  if (/^\|\s*R-\d+\s*\|/.test(line) && /RESOLVED|WITHDRAWN|EXCLUDED/i.test(line)) return true
  if (/^\|\s*F\d+-R\d+\w*\s*\|/.test(line) && /WITHDRAWN|EXCLUDED/i.test(line)) return true
  return false
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.wrangler') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(md|ts|html)$/.test(name)) out.push(p)
  }
  return out
}

const roots = ['docs', 'infra', 'apps/afirmico-tesla/src', 'apps/afirmico-tesla/public',
               'apps/afirmico-tesla/README.md']
const files = roots.flatMap((r) => {
  const p = join(repo, r)
  try { return statSync(p).isDirectory() ? walk(p) : [p] } catch { return [] }
}).filter((f) => !isHistoricalFile(f))

describe('no operative copy asserts a bound on the collected set (F01-R10, v1.25)', () => {
  it('finds the documents it is supposed to be checking', () => {
    // Guard against a vacuous pass from walking an empty list.
    expect(files.length).toBeGreaterThan(8)
    expect(files.some((f) => f.endsWith('FRS-010-afirmico-auto-tesla-fleet-data-v1.md'))).toBe(true)
    expect(files.some((f) => f.endsWith('SDD-010-afirmico-auto-telemetry-architecture-v1.md'))).toBe(true)
    expect(files.some((f) => f.endsWith('src/index.ts'))).toBe(true)
  })

  it('has no banned phrasing in operative text', () => {
    const found: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (isHistoricalLine(line)) return
        for (const [label, re] of BANNED) {
          if (re.test(line)) found.push(`${f.replace(repo, '')}:${i + 1} [${label}]`)
        }
      })
    }
    expect(found).toEqual([])
  })

  it('states no field list in the member-facing pages', () => {
    // F01-R10: the member is not shown the collected fields. Assert on the copy
    // the worker renders, not on the spec, which legitimately holds the list.
    const src = readFileSync(join(repo, 'apps/afirmico-tesla/src/index.ts'), 'utf8')
    for (const line of src.split('\n')) {
      if (!/(<p|<li|<h[1-3]|class="meta")/.test(line)) continue
      expect(line, 'page copy names a collected field').not.toMatch(
        /\b(Odometer|MilesSinceReset|SelfDrivingMilesSinceReset|SentryMode|PinToDrive|EfficiencyPackage)\b/,
      )
    }
  })

  it('the authoritative set is still the ruled set (the ruling removed text, not data)', () => {
    // This revision must not have narrowed the set by accident. Migration 0013 adds
    // Trim (the variant badge) at the owner's explicit request, so the set is 15, not
    // 14 — the cardinality is pinned so an accidental narrowing still fails here.
    const src = readFileSync(join(repo, 'apps/afirmico-tesla/src/consent-policy.ts'), 'utf8')
    const m = src.match(/export const CONSENTED_FIELDS = \[(.*?)\] as const/s)
    expect(m, 'CONSENTED_FIELDS not found').toBeTruthy()
    const keys = [...(m![1].matchAll(/'([^']+)'/g))].map((x) => x[1])
    expect(keys.length).toBe(15)
    expect(keys).toContain('Odometer')
    expect(keys).toContain('SelfDrivingMilesSinceReset')
    expect(keys).toContain('Trim')
  })

  it('SDD 4.1 config matches the authoritative set, not the retired polling set', () => {
    // §4.1 is the artifact actually sent to vehicles; it must mirror §3.7.
    const sdd = readFileSync(
      join(repo, 'docs/SDD-010-afirmico-auto-telemetry-architecture-v1.md'), 'utf8',
    )
    const cfg = sdd.slice(sdd.indexOf('"fields": {'), sdd.indexOf('"fields": {') + 2000)
    for (const retired of ['BatteryLevel', 'LocatedAtHome', 'LocatedAtWork']) {
      expect(cfg, `retired polling field ${retired} still in the config`).not.toContain(retired)
    }
    expect(cfg).toContain('Odometer')
    expect(cfg).toContain('SelfDrivingMilesSinceReset')
  })
})
