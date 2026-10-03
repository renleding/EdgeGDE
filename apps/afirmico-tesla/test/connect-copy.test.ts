/**
 * Tests for the /toca-connect summary paragraph (FRS-010 F01-R10, F01-R13).
 *
 * The paragraph is page chrome, not the agreed text, so the F01 AC5 hash pin in
 * consent.test.ts does not cover it. That is exactly how it drifted: the
 * authorisation was broadened in v1.17 while the intro still promised "the full
 * list of what is collected" and still said the member approves "the key".
 *
 * There is no route-level test harness in this project (the suite targets logic
 * modules, not Hono handlers), so this asserts the copy at its single source —
 * src/index.ts — normalising whitespace, since the template literal wraps lines
 * and a re-wrap must not be treated as a wording change.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const indexPath = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const source = readFileSync(indexPath, 'utf8')
const flat = source.replace(/\s+/g, ' ')

describe('/toca-connect summary paragraph (F01-R10)', () => {
  it('states the wording in force', () => {
    expect(flat).toContain(
      'Your authorisation is required as below, and you can revoke it at any time. ' +
        'Nothing is collected until you approve AFRIMICO Auto in the Tesla app.',
    )
  })

  it('does not open by describing what the data is used to build (v1.24)', () => {
    // Removed at the owner's instruction. The promise of a "driving profile" is
    // a purpose statement, and the purposes in the authorisation are broader
    // than profile-building — so the intro must not lead with one of them.
    expect(flat).not.toContain('reads data from your Tesla services')
    expect(flat).not.toContain('build your driving profile')
  })

  it('refers to Tesla services, not the vehicle alone', () => {
    expect(flat).not.toContain('reads data from your Tesla to build')
  })

  it('does not promise an enumerated field list (F01-R02a)', () => {
    expect(flat).not.toContain('the full list of what is collected')
    expect(flat.toLowerCase()).not.toContain('full list of what is collected')
  })

  it('says the member approves the application, not the key', () => {
    expect(flat).not.toContain('approve the key in the Tesla app')
  })
})
