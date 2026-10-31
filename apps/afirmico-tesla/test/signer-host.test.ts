/**
 * Retired-claim scan for the signer/relay host split.
 *
 * History. This file used to also assert the *contents* of FRS-010 and SDD-010:
 * that the SDD diagram drew the signer as its own tier, that the signer stayed
 * out of the internet-facing port story, that §9 O-4 remained open, and that
 * F02-R11 named a role without placing it on a host.
 *
 * Those assertions are about what the specifications say, so they moved with the
 * documents when the specification corpus left this repository (2026-10-31) and
 * now run in the corpus CI. Keeping them here would have required the specs to
 * stay in the repo forever.
 *
 * What remains is the half that belongs to this repository: no *operative text*
 * may assert either retired claim. That is a property of this codebase, not of
 * the specifications, so it is checked here and needs no access to the docs.
 *
 * Why the claims matter. The architecture said two contradictory things at once:
 * SDD-010 §2 drew `tesla-http-proxy` inside the relay box and asserted "Both
 * share ONE private key", while the recorded decision was that the signer runs
 * on a separate host. Three research passes over Tesla's documentation
 * established:
 *   - the Fleet Telemetry server MUST be publicly exposed (vehicles dial in);
 *   - the configuration-signing key SHOULD be kept offline and in an HSM;
 *   - the proxy must NOT listen without client authentication.
 * None of them requires co-location, and the key guidance points the other way.
 *
 * Both retired claims fail silently rather than loudly:
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
 * The scan is scoped so that changelog rows and revision notes may quote what was
 * retired, and test files may name the phrasing they ban.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../..', import.meta.url))

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
  // docs/html/*.html is a generated, gitignored mirror of the .md sources. The
  // historical exemptions in historicalLines() are markdown syntax, so an HTML
  // render can never be exempted by them: a stale render flags lines the .md
  // scan already accepted. The .md file itself is in `files`, so the mirror can
  // only add false positives on content already covered.
  .filter((f) => !/\/docs\/html\//.test(f))

describe('retired co-location claims stay out of operative text', () => {
  it('scans a meaningful body of files', () => {
    expect(files.length).toBeGreaterThan(5)
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
})
