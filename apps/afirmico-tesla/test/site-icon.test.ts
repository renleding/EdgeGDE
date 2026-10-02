/**
 * Tests for the shared site icon (FRS-010 F01-R11).
 *
 * Why this exists: the icon was declared in three unrelated places and agreed
 * with itself in none of them.
 *   - the worker's page() chrome declared no icon at all, so /connect, /dashboard,
 *     the auth pages and every error page had none;
 *   - the static splash declared its icon as an inline data-URI, which no other
 *     page could reuse;
 *   - /favicon.ico -- the one path browsers request unprompted -- was not routed
 *     to the worker, so it fell through to the static asset fallback and answered
 *     with 3,721 bytes of HTML and content-type text/html.
 *
 * A test that only checked "the link tag exists" would have passed against any of
 * those three. These assertions pin the properties that were actually broken: one
 * shared href, both fixed paths served as an image, and no second definition.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SOURCE = readFileSync(join(APP_DIR, 'src/index.ts'), 'utf-8')
const SPLASH = readFileSync(join(APP_DIR, 'public/index.html'), 'utf-8')
const WRANGLER = readFileSync(join(APP_DIR, 'wrangler.json'), 'utf-8')

/** The href the worker declares, e.g. `/favicon.svg`. */
function workerHref(): string {
  const m = SOURCE.match(/const FAVICON_HREF = '([^']+)'/)
  if (!m) throw new Error('FAVICON_HREF is not declared in src/index.ts')
  return m[1]
}

describe('F01-R11 shared site icon', () => {
  it('the worker chrome declares the icon', () => {
    // page() is the <head> for every worker-rendered page.
    const start = SOURCE.indexOf('function page(')
    const head = SOURCE.slice(start, start + 1200)
    expect(head).toContain('rel="icon"')
    expect(head).toContain('FAVICON_HREF')
    expect(head).toContain('rel="apple-touch-icon"')
  })

  it('both fixed browser paths are routed and served as an image', () => {
    for (const path of ['/favicon.svg', '/favicon.ico']) {
      expect(SOURCE).toContain(`app.get('${path}'`)
    }
    // content-type must be the icon type, not HTML. This is the assertion that
    // fails if the routes are lost again and the splash answers instead.
    const type = SOURCE.match(/const FAVICON_CONTENT_TYPE = '([^']+)'/)?.[1]
    expect(type).toBe('image/svg+xml')
    expect(SOURCE).toContain("'content-type': FAVICON_CONTENT_TYPE")
  })

  it('both paths win over the static asset fallback', () => {
    const config = JSON.parse(WRANGLER)
    const first = config.assets.run_worker_first
    expect(first).toContain('/favicon.svg')
    expect(first).toContain('/favicon.ico')
    const patterns = config.routes.map((r: { pattern: string }) => r.pattern)
    expect(patterns).toContain('auto.afirmi.co/favicon.svg')
    expect(patterns).toContain('auto.afirmi.co/favicon.ico')
  })

  it('the splash uses the same icon, not its own copy', () => {
    expect(SPLASH).toContain(`href="${workerHref()}"`)
    expect(SPLASH).toContain('rel="apple-touch-icon"')
    // The old inline data-URI was a second definition that could not be shared.
    expect(SPLASH).not.toContain('data:image/svg+xml')
  })

  it('the worker chrome also defines the icon only once', () => {
    // A data-URI in page() would be a second definition.
    expect(SOURCE).not.toContain('data:image/svg+xml')
  })
})
