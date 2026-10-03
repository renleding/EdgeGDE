/**
 * Tests for the onboarding path rename (FRS-010 F01-R13).
 *
 * The page moved from `/connect` to `/toca-connect` so that the URL says which
 * membership the connection belongs to: the member arrives from inside the TOCA
 * member site, and a bare `/connect` was ambiguous the moment a second
 * membership programme existed.
 *
 * Two things must hold together, and testing only the first is the trap: every
 * internal link and redirect must use the new path, AND the old path must still
 * resolve. A rename that updates all 18 call sites but 404s on `/connect` breaks
 * every link already published inside the member site, and a member who hits a
 * dead end during onboarding cannot tell that apart from a broken platform.
 *
 * There is no route-level test harness here (the suite targets logic modules,
 * not Hono handlers), so this asserts against src/index.ts directly.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const indexPath = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const source = readFileSync(indexPath, 'utf8')

describe('onboarding path is /toca-connect (F01-R13)', () => {
  it('registers the page at the new path', () => {
    expect(source).toContain("app.get('/toca-connect'")
  })

  it('keeps the old path alive as a permanent redirect', () => {
    // Not a deletion: anything already pointing at /connect must still land.
    expect(source).toMatch(/app\.get\('\/connect',\s*\(c\)\s*=>\s*c\.redirect\('\/toca-connect',\s*301\)\)/)
  })

  it('redirects the old path permanently, not temporarily', () => {
    // 301 lets the redirect be cached, which matters for a path that was live
    // and linked from outside this repository.
    const m = source.match(/app\.get\('\/connect',\s*\(c\)\s*=>\s*c\.redirect\('\/toca-connect',\s*(\d+)\)\)/)
    expect(m?.[1]).toBe('301')
  })

  it('exposes the old path over GET only', () => {
    // A POST to the retired path must not be silently accepted or redirected
    // into the consent flow; only the page move is being honoured.
    expect(source).not.toContain("app.post('/connect'")
    expect(source).not.toContain("app.all('/connect'")
  })

  it('has no internal link or redirect still pointing at the old path', () => {
    // Every remaining '/connect' reference must be the redirect route itself,
    // the redirect target, or prose. Strip those two known lines, then assert.
    const withoutRedirect = source
      .split('\n')
      .filter((l) => !l.includes("app.get('/connect'") && !l.includes("'/toca-connect'"))
      .join('\n')
    expect(withoutRedirect).not.toMatch(/href="\/connect"/)
    expect(withoutRedirect).not.toMatch(/redirect\('\/connect'/)
    expect(withoutRedirect).not.toMatch(/location:\s*'\/connect'/)
  })

  it('uses the new path for the consent redirect target', () => {
    // The logout/consent-failure paths must send the member to the live page.
    expect(source).toContain("location: '/toca-connect'")
  })
})
