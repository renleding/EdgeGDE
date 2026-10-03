/**
 * Tests for the shared site icon (FRS-010 F01-R11, F01-R12).
 *
 * Why this exists: the icon was declared in three unrelated places and agreed
 * with itself in none of them.
 *   - the worker's page() chrome had no icon link at all
 *   - /favicon.ico was unrouted, so it returned the HTML splash (3721 bytes of
 *     text/html) instead of an image
 *   - the splash carried its own inline data-URI icon, different from the above
 *   - the worker held twelve path-scoped routes and no route for the bare host,
 *     so "/" was answered by a retired catch-all worker serving its own copy of
 *     the splash -- the edited public/index.html was reachable at no path
 *
 * The invariant these tests pin is "one definition, every path". scripts/
 * check-site-icon.sh proves they are not tautologies by re-breaking each of
 * those four things in turn.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const src = readFileSync(resolve(APP, 'src/index.ts'), 'utf8')
const splash = readFileSync(resolve(APP, 'public/index.html'), 'utf8')
const wrangler = readFileSync(resolve(APP, 'wrangler.json'), 'utf8')

const ICON_PATHS = ['/favicon.svg', '/favicon.ico'] as const

describe('F01-R11 shared site icon', () => {
  it('has exactly one inline definition of the icon', () => {
    // It must exist, or the two routes below would serve an empty body.
    expect(src).toMatch(/const FAVICON_SVG\s*=/)
    // One definition, not a copy per surface: the payload is assigned once.
    expect(src.match(/const FAVICON_SVG\s*[:=]/g) ?? []).toHaveLength(1)
  })

  it('declares the icon as SVG, matching the asset it serves', () => {
    expect(src).toMatch(/const FAVICON_CONTENT_TYPE\s*=\s*'image\/svg\+xml'/)
    expect(src).toMatch(/const FAVICON_HREF\s*=\s*'\/favicon\.svg'/)
  })

  it('routes both conventional icon paths before any other handler', () => {
    for (const p of ICON_PATHS) {
      expect(src, `${p} has no route`).toContain(`app.get('${p}'`)
    }
    // Registered ahead of the first page handler so nothing can shadow them.
    const firstIcon = Math.min(...ICON_PATHS.map((p) => src.indexOf(`app.get('${p}'`)))
    const firstOther = src.indexOf("app.get('/connect'")
    expect(firstIcon).toBeGreaterThan(-1)
    expect(firstIcon).toBeLessThan(firstOther)
  })

  it('gives every worker-rendered page the same icon links', () => {
    // page() is the only chrome the worker renders, so fixing it once is what
    // makes /connect, /dashboard, /auth/* and the error pages agree. The links
    // interpolate the shared constants rather than repeating the literal href,
    // which is the stronger form of "one definition".
    const pageFn = src.slice(src.indexOf('function page('))
    const body = pageFn.slice(0, pageFn.indexOf('\n}'))
    expect(body).toMatch(/rel="icon"[^>]*href="\$\{FAVICON_HREF\}"/)
    expect(body).toContain('href="/favicon.ico"')
    expect(body).toMatch(/rel="apple-touch-icon"/)
  })

  it('uses only the shared icon in the splash, with no inline icon data', () => {
    // The splash must not carry a second, private copy of the icon.
    expect(splash).not.toMatch(/data:image\//)
    expect(splash).not.toMatch(/rel="(shortcut )?icon"[^>]*data:/)
    for (const p of ICON_PATHS) {
      expect(splash, `splash omits ${p}`).toContain(`href="${p}"`)
    }
    expect(splash).toContain('rel="apple-touch-icon"')
  })
})

describe('F01-R12 the worker owns the whole host', () => {
  it('attaches one wildcard route covering every path', () => {
    const routes = JSON.parse(wrangler).routes as { pattern: string }[]
    expect(routes.map((r) => r.pattern)).toEqual(['auto.afirmi.co/*'])
  })

  it('serves "/" from its own asset layer, not an origin proxy', () => {
    // Assets run first so "/" resolves to public/index.html. With
    // run_worker_first the request would reach app.notFound instead, which has
    // to answer from ASSETS and must not proxy back to the origin -- with a
    // host-wide route that proxy either recurses into this worker or reaches
    // the retired catch-all worker that served its own splash.
    const assets = (JSON.parse(wrangler).assets ?? {}) as Record<string, unknown>
    expect(assets.directory).toBe('./public')
    expect(assets.run_worker_first).toBeUndefined()

    const notFound = src.slice(src.indexOf('app.notFound('))
    expect(notFound).not.toContain('fetch(c.req.raw)')
    expect(notFound).toContain('c.env.ASSETS.fetch')
    expect(notFound).toContain("new URL('/', c.req.url)")
  })

  it('keeps the splash the asset layer will actually serve', () => {
    // The referenced file must exist under the assets directory, or "/" 404s.
    expect(assetsDirectoryExists()).toBe(true)
  })
})

function assetsDirectoryExists(): boolean {
  try {
    readFileSync(resolve(APP, 'public/index.html'))
    return true
  } catch {
    return false
  }
}
