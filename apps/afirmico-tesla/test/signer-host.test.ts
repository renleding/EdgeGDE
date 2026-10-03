/**
 * Tests for the signer/relay host split (FRS-010 F02-R11; SDD-010 §2, rev 1.11).
 *
 * Why this test exists. The architecture said two contradictory things at once:
 * SDD-010 §2 drew `tesla-http-proxy` inside the relay box and asserted "Both
 * share ONE private key", while our own recorded decision was that the signer
 * runs on a separate host. The owner spotted the contradiction and asked for a
 * sourced answer, which is the right way round — a design claim that only the
 * document asserts is not a design.
 *
 * Three research passes over Tesla's documentation established:
 *   - the Fleet Telemetry server MUST be publicly exposed (vehicles dial in);
 *   - the configuration-signing key SHOULD be kept offline and in an HSM;
 *   - the proxy must NOT listen without client authentication.
 * None of them requires co-location, and the key guidance points the other way.
 *
 * Two claims are therefore retired, and each is a way this requirement fails
 * silently rather than loudly:
 *
 *   1. "Both share ONE private key" — factually wrong in either layout.
 *      `fleet-telemetry` terminates vehicle mTLS with its OWN Let's Encrypt
 *      server certificate; only the signer holds the application key. A reader
 *      who believed this would provision the key onto the public host.
 *   2. The "Tesla partner allowlist" rationale for the signer's location. No
 *      Tesla source requires one; it was an open question (§9 O-4) narrated as
 *      a settled fact. A fabricated rationale is worse than a missing one,
 *      because it closes the question it should have left open.
 *
 * The scan is scoped like `general-authorisation-copy.test.ts`: changelog rows
 * and revision notes must be able to quote what was retired, and test files must
 * be able to name the phrasing they ban.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../..', import.meta.url))

const SDD = join(repo, 'docs/SDD-010-afirmico-auto-telemetry-architecture-v1.md')
const FRS = join(repo, 'docs/FRS-010-afirmico-auto-tesla-fleet-data-v1.md')

/** Retired claims, each formerly asserted as operative design. */
const BANNED: Array<[string, RegExp]> = [
  ['"both share ONE private key"', /both share one private key/i],
  ['the relay holds the application private key', /the private key lives there/i],
  ['signer is called "from the same host"', /from the same host/i],
  ['"Tesla partner allowlist" as a stated requirement', /tesla partner allowlist/i],
]

/**
 * Changelog rows and revision notes quote retired text on purpose.
 *
 * A revision note is a multi-line paragraph, not a line — flagging only its
 * first line leaves every subsequent sentence of the explanation fair game,
 * which is where a note actually names the wording it retired. So historical
 * regions are computed as line ranges: a changelog table row, or a block
 * running from `**Revision note (` up to the next horizontal rule.
 */
function historicalLines(text: string): Set<number> {
  const out = new Set<number>()
  const lines = text.split('\n')
  let inNote = false
  lines.forEach((line, i) => {
    const n = i + 1
    if (/^\|\s*1\.\d+\s*\|/.test(line)) out.add(n) // changelog row
    if (/^\*\*Revision note \(/.test(line)) inNote = true
    if (inNote) {
      out.add(n)
      if (/^---\s*$/.test(line)) inNote = false
    }
  })
  return out
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(md|ts|html)$/.test(name)) out.push(p)
  }
  return out
}

const roots = ['docs', 'infra', 'apps/afirmico-tesla/src', 'apps/afirmico-tesla/public']
const files = roots
  .flatMap((r) => {
    const p = join(repo, r)
    try {
      return statSync(p).isDirectory() ? walk(p) : [p]
    } catch {
      return []
    }
  })
  .filter((f) => !/\/test\//.test(f))

describe('the signer is not co-located with the relay (SDD-010 §2, rev 1.11)', () => {
  it('finds the documents it is supposed to be checking', () => {
    expect(files.length).toBeGreaterThan(5)
    expect(files).toContain(SDD)
    expect(files).toContain(FRS)
  })

  it('asserts no retired co-location claim in operative text', () => {
    const found: string[] = []
    for (const f of files) {
      const text: string = readFileSync(f, 'utf8')
      const historical = historicalLines(text)
      text.split('\n').forEach((line: string, i: number) => {
        if (historical.has(i + 1)) return
        for (const [label, re] of BANNED) {
          if (re.test(line)) found.push(`${f.replace(repo, '')}:${i + 1} [${label}]`)
        }
      })
    }
    expect(found).toEqual([])
  })

  it('draws the signer as its own tier, outside the relay box', () => {
    const sdd = readFileSync(SDD, 'utf8')
    const diagram = sdd.slice(sdd.indexOf('## 2. Component Boundaries'), sdd.indexOf('## 3. Data Flow'))
    expect(diagram).toMatch(/TIER 2b .*Config signer/)
    // The relay box must explicitly deny holding the key, or a reader will
    // assume it does — that assumption is the defect this test guards.
    expect(diagram).toMatch(/holds NO application private key/)
  })

  it('keeps the signer out of the internet-facing port story', () => {
    const sdd = readFileSync(SDD, 'utf8')
    // The relay is the only public component; the signer takes no inbound port.
    expect(sdd).toMatch(/The signer must NOT be internet-facing|must NOT be internet-facing/i)
    expect(sdd).toMatch(/no inbound port/i)
  })

  it('leaves the egress-IP question OPEN rather than answered', () => {
    // It was withdrawn because it was never verified. If a future revision
    // resolves it, resolve it with a citation and delete this expectation
    // deliberately — do not let it drift back to an asserted fact.
    const sdd = readFileSync(SDD, 'utf8')
    const o4 = sdd.slice(sdd.indexOf('| O-4 |'), sdd.indexOf('| O-5 |'))
    expect(o4).toMatch(/not asserted anywhere|Build phase/i)
  })

  it('F02-R11 names the signing role only, placing it on no host', () => {
    const frs = readFileSync(FRS, 'utf8')
    const row = frs.slice(frs.indexOf('| F02-R11 |'), frs.indexOf('| F02-R12 |'))
    expect(row).toMatch(/configuration signer/i)
    expect(row).not.toMatch(/same host|relay host/i)
  })
})
